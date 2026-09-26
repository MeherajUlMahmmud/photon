import * as React from "react";
import { AppWindow, Eye, NotePencil, PencilSimpleLine, X } from "@phosphor-icons/react";
import type { ChatImage, ChatMessage, CompletionEvent, DictationEngine, ScreenPermission } from "../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { useAsync } from "@/hooks/use-async";
import { DICTATION_ENGINE_KEY, useDictation } from "@/hooks/use-dictation";
import { useToast } from "@/hooks/use-toast";
import { useShortcut } from "@/hooks/use-keymap";
import type { TextTurn } from "@/hooks/use-chats";
import { AssistantTurn, PendingTurn, UserTurn } from "@/components/chat/turn";
import { Composer } from "@/components/chat/composer";
import { ModelPicker } from "@/components/chat/model-picker";
import { AttachButton, AttachmentTray, DropZone, useAttachments } from "@/components/chat/attachments";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { acceleratorKeys, isMac } from "@/lib/accelerator";
import { composeMessage, imageUrl, newAttachmentId, type Attachment } from "@/lib/attachments";
import { resolveModel, type ModelPick } from "@/lib/models";
import { errorMessage } from "@/lib/utils";

const SYSTEM_PROMPT = [
  "You are Photon, a companion that sits on top of the user's desktop.",
  "Images attached to a message are usually screenshots of the user's screen taken the moment they asked,",
  "sometimes marked up by the user with boxes, arrows, strokes or notes that point at what they mean;",
  "answer about what is actually visible, naming the specific app, text or element, and give marked areas priority.",
  "Files the user attached appear inside <file> tags.",
  "Earlier images are not resent, so if a question depends on the screen and none is attached, say so.",
  "The window is small: answer briefly and get to the point.",
].join(" ");

const SCREEN_ID = "screen";
const MODEL_KEY = "photon.companion.model";

/** A turn in the overlay. User turns keep their images and file names for display only; nothing is saved. */
type CompanionTurn = TextTurn & { shown?: { images: string[]; files: string[] } };

function newId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function focusComposer() {
  document.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.focus();
}

function loadPick(): ModelPick | null {
  try {
    const raw = localStorage.getItem(MODEL_KEY);
    return raw ? (JSON.parse(raw) as ModelPick) : null;
  } catch {
    return null;
  }
}

/** Drag strip across the top of the frameless window, with the overlay's few actions. */
function TitleBar({ onNew, canReset }: { onNew: () => void; canReset: boolean }) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-3 [-webkit-app-region:drag]">
      <span className="size-2 rotate-45 rounded-[1px] bg-black" aria-hidden="true" />
      <span className="ml-1.5 flex-1 font-display text-small font-bold tracking-tight">Photon</span>
      <div className="flex items-center [-webkit-app-region:no-drag]">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => void window.photon.startAnnotation()}
          aria-label="Annotate the screen"
          title="Annotate the screen"
        >
          <PencilSimpleLine />
        </Button>
        {canReset && (
          <Button size="icon-sm" variant="ghost" onClick={onNew} aria-label="New conversation" title="New conversation">
            <NotePencil />
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => void window.photon.openMainWindow()}
          aria-label="Open the Photon window"
          title="Open the Photon window"
        >
          <AppWindow />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => void window.photon.hideCompanion()} aria-label="Hide (Esc)" title="Hide (Esc)">
          <X />
        </Button>
      </div>
    </header>
  );
}

function PermissionNotice() {
  return (
    <Alert className="mb-2">
      <AlertDescription>
        Photon can't see your screen yet. Allow it under Privacy &amp; Security, Screen Recording, then quit and reopen
        Photon.{" "}
        <button type="button" className="underline" onClick={() => void window.photon.openScreenPermissionSettings()}>
          Open settings
        </button>
      </AlertDescription>
    </Alert>
  );
}

/** Images and file names a user turn went out with. */
function SentAttachments({ shown }: { shown: NonNullable<CompanionTurn["shown"]> }) {
  return (
    <div className="flex max-w-[75%] flex-wrap justify-end gap-1.5">
      {shown.images.map((src, i) => (
        <img key={i} src={src} alt="Image sent with this message" className="h-16 w-auto max-w-full rounded-md border border-border" />
      ))}
      {shown.files.map((name) => (
        <span key={name} className="max-w-full truncate rounded-sm border border-input bg-sheet px-1.5 font-mono text-micro text-slate">
          {name}
        </span>
      ))}
    </div>
  );
}

function Companion() {
  const { user, call } = useAuth();
  const { toast } = useToast();
  const initials = (user?.first_name?.[0] ?? user?.email[0] ?? "?").toUpperCase();

  const [turns, setTurns] = React.useState<CompanionTurn[]>([]);
  const [draft, setDraft] = React.useState("");
  const attachments = useAttachments((message) => toast(message, "error"));
  const [permission, setPermission] = React.useState<ScreenPermission>("unknown");
  const [shortcut, setShortcut] = React.useState<string | null>(null);
  const [capturing, setCapturing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const streamRef = React.useRef<string | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  // Provider and model: the user's pick for the companion, falling back to the first provider with a key.
  const providers = useAsync(() => call((t) => window.photon.listProviders(t)), [user?.id]);
  const ready = React.useMemo(() => providers.data?.filter((p) => p.has_key) ?? [], [providers.data]);
  const [pick, setPick] = React.useState<ModelPick | null>(loadPick);
  const { current, model } = resolveModel(ready, pick);

  const engineSetting = useAsync(() => call((t) => window.photon.getSetting(t, DICTATION_ENGINE_KEY)), [user?.id]);
  const engine: DictationEngine = engineSetting.data === "cloud" ? "cloud" : "local";
  const canDictate = engine === "local" || ready.some((p) => p.capabilities.includes("transcription"));
  const dictation = useDictation(
    engine,
    (text) => setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, "")} ${text}` : text)),
    (message) => toast(message, "error"),
  );

  /** The screenshot is one attachment among others; a new capture replaces the previous one. */
  const setScreen = React.useCallback(
    (image: ChatImage) => {
      attachments.remove(SCREEN_ID);
      attachments.add([{ id: SCREEN_ID, kind: "image", name: "Your screen", image }]);
    },
    [attachments.remove, attachments.add],
  );

  const sendRef = React.useRef<(content: string, extra?: Attachment[]) => void>(() => undefined);

  React.useEffect(() => {
    void window.photon.companionInfo().then((info) => {
      setShortcut(info.shortcut);
      setPermission(info.permission);
    });
    async function drain() {
      const { capture, attach } = await window.photon.takeCompanionPending();
      if (capture) {
        setPermission(capture.permission);
        // A failed capture keeps whatever was attached before rather than dropping it.
        if (capture.screenshot) setScreen(capture.screenshot.image);
      }
      // From the annotate overlay: attach the marked-up picture; send at once when it came with a question.
      for (const a of attach ?? []) {
        const item: Attachment = { id: newAttachmentId(), kind: "image", name: a.name, image: a.image };
        if (a.note.trim()) sendRef.current(a.note.trim(), [item]);
        else attachments.add([item]);
      }
      if (capture || attach?.length) requestAnimationFrame(focusComposer);
    }
    // A summon can happen before this component mounts (first open, still signing in), so drain now too.
    void drain();
    return window.photon.onCompanionPending(() => void drain());
  }, [setScreen, attachments.add]);

  useShortcut("companion.hide", () => void window.photon.hideCompanion(), { inFields: true });

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  // One listener for every stream; events for anything but the current stream are ignored.
  React.useEffect(
    () =>
      window.photon.onCompletionEvent((streamId, event: CompletionEvent) => {
        if (streamId !== streamRef.current) return;
        if (event.type === "start") {
          setTurns((prev) => [
            ...prev,
            { role: "assistant", content: "", at: Date.now(), streaming: true, meta: { ...event, call_id: "" } },
          ]);
        } else if (event.type === "delta") {
          setTurns((prev) => {
            const last = prev[prev.length - 1];
            if (!last?.streaming) return prev;
            return [...prev.slice(0, -1), { ...last, content: last.content + event.text }];
          });
        } else if (event.type === "done") {
          setTurns((prev) => {
            const last = prev[prev.length - 1];
            if (!last?.streaming) return prev;
            const meta = {
              provider: event.provider,
              model: event.model,
              inputTokens: event.usage.input_tokens,
              outputTokens: event.usage.output_tokens,
              tokens: event.usage.total_tokens,
              call_id: event.call_id,
            };
            return [...prev.slice(0, -1), { ...last, streaming: false, meta }];
          });
        } else if (event.type === "error") {
          setError(event.message);
        }
      }),
    [],
  );

  async function capture() {
    setCapturing(true);
    try {
      const result = await window.photon.captureScreen();
      setPermission(result.permission);
      if (result.screenshot) setScreen(result.screenshot.image);
    } finally {
      setCapturing(false);
    }
  }

  async function send(content: string, extra: Attachment[] = []) {
    const items = [...attachments.items, ...extra];
    if ((!content && !items.length) || busy) return;
    const message = composeMessage(content, items);
    const shown = {
      images: items.flatMap((a) => (a.kind === "image" ? [imageUrl(a.image)] : [])),
      files: items.flatMap((a) => (a.kind === "text" ? [a.name] : [])),
    };
    // The bubble shows what was typed; attached files are listed under it, not dumped into it.
    const userTurn: CompanionTurn = { role: "user", content: content || "(attachment)", at: Date.now(), shown };
    const history = turns;
    setTurns([...history, userTurn]);
    setDraft("");
    attachments.clear();
    setError(null);
    setBusy(true);

    // Earlier turns go back as text only; images ride on the message they were attached to.
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.map(({ role, content: c }) => ({ role, content: c })),
      message,
    ];

    const streamId = newId();
    streamRef.current = streamId;
    try {
      await call((t) =>
        window.photon.streamCompletion(t, streamId, {
          messages,
          task_key: "companion",
          ...(current ? { provider: current.provider, model } : {}),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (streamRef.current === streamId) streamRef.current = null;
      // A stream that ended without `done` (stop, disconnect) keeps its text but stops pulsing.
      setTurns((prev) => prev.map((t) => (t.streaming ? { ...t, streaming: false } : t)));
      setBusy(false);
    }
  }
  sendRef.current = (content, extra) => void send(content, extra);

  function stop() {
    if (streamRef.current) void window.photon.cancelCompletion(streamRef.current);
  }

  function reset() {
    stop();
    setTurns([]);
    setError(null);
    focusComposer();
  }

  function onPick(provider: string, next: string) {
    const value = { provider, model: next };
    setPick(value);
    try {
      localStorage.setItem(MODEL_KEY, JSON.stringify(value));
    } catch {
      // Remembering the pick is a convenience only.
    }
  }

  const last = turns[turns.length - 1];
  const waiting = busy && !last?.streaming;
  const blocked = permission === "denied" || permission === "restricted";
  const keys = shortcut ? acceleratorKeys(shortcut, isMac()) : null;
  const hasScreen = attachments.items.some((a) => a.id === SCREEN_ID);

  return (
    <DropZone className="flex h-svh flex-col bg-background" onFiles={(files) => void attachments.addFiles(files)}>
      <TitleBar onNew={reset} canReset={turns.length > 0} />

      <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4">
        {turns.length === 0 ? (
          <div className="animate-rise px-1 pt-2">
            <h1 className="font-display text-section">Ask about your screen.</h1>
            <p className="mt-2 max-w-[60ch] text-small text-slate">
              {hasScreen
                ? "Photon took a picture of your screen when it opened. It goes with your next message and is not saved."
                : "Click Look at my screen to send a picture of it with your next message. Pictures are never saved."}{" "}
              Drop or paste files to ask about them too.
              {keys && (
                <>
                  {" "}
                  Press{" "}
                  {keys.map((k, i) => (
                    <kbd key={i} className="mr-0.5">
                      {k}
                    </kbd>
                  ))}{" "}
                  in any app to bring Photon back.
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="grid gap-5">
            {turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="grid justify-items-end gap-1.5">
                  {t.shown && (t.shown.images.length > 0 || t.shown.files.length > 0) && <SentAttachments shown={t.shown} />}
                  <UserTurn turn={t} initials={initials} />
                </div>
              ) : (
                <AssistantTurn key={i} turn={t} />
              ),
            )}
            {waiting && <PendingTurn />}
          </div>
        )}
        {error && (
          <Alert className="mt-4 animate-reveal">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div ref={endRef} />
      </main>

      <div className="shrink-0 pt-2">
        {blocked && (
          <div className="px-3">
            <PermissionNotice />
          </div>
        )}
        <Composer
          compact
          value={draft}
          onChange={setDraft}
          onSend={() => void send(draft.trim())}
          onStop={busy ? stop : undefined}
          disabled={false}
          canSend={Boolean(draft.trim()) || attachments.items.length > 0}
          placeholder={hasScreen ? "Ask about your screen…" : "Ask Photon…"}
          dictation={canDictate ? dictation : undefined}
          onPaste={attachments.onPaste}
          leading={<AttachButton onFiles={(files) => void attachments.addFiles(files)} disabled={busy} />}
          attachments={<AttachmentTray items={attachments.items} onRemove={attachments.remove} />}
          actions={
            !blocked && (
              <Button size="sm" variant="ghost" onClick={() => void capture()} disabled={capturing} className="mr-auto">
                <Eye />
                {capturing ? "Looking…" : hasScreen ? "Look again" : "Look at my screen"}
              </Button>
            )
          }
          footer={
            <ModelPicker providers={ready} current={current} model={model} loading={providers.loading} onPick={onPick} />
          }
        />
      </div>
    </DropZone>
  );
}

/**
 * The floating companion window (`#/companion`). Signs in through the main
 * window: both share one token pair in storage.
 */
export function CompanionPage() {
  const { status } = useAuth();
  if (status === "authenticated") return <Companion />;
  return (
    <div className="flex h-svh flex-col bg-background">
      <TitleBar onNew={() => undefined} canReset={false} />
      <div className="grid flex-1 place-items-center px-6 text-center">
        <div className="animate-rise">
          <p>Sign in to Photon in the main window first.</p>
          <Button className="mt-4" onClick={() => void window.photon.openMainWindow()}>
            Open Photon
          </Button>
        </div>
      </div>
    </div>
  );
}
