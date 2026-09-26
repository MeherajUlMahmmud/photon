import * as React from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { SidebarSimple } from "@phosphor-icons/react";
import type { AppAnnotation, DictationEngine } from "../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { useAsync } from "@/hooks/use-async";
import { useChats, type Turn } from "@/hooks/use-chats";
import { useSkills } from "@/hooks/use-skills";
import { parseInvocation } from "@/lib/skills";
import { resolveModel, type ModelPick as Pick } from "@/lib/models";
import { useStoredFlag } from "@/hooks/use-stored-flag";
import { DICTATION_ENGINE_KEY, useDictation } from "@/hooks/use-dictation";
import { useToast } from "@/hooks/use-toast";
import { FolderExplorer } from "@/components/layout/folder-explorer";
import { HeaderActions } from "@/components/layout/header-actions";
import { AssistantTurn, PendingTurn, UserTurn } from "@/components/chat/turn";
import { ToolTurnCard } from "@/components/chat/tool-turn";
import { Composer } from "@/components/chat/composer";
import { ModelPicker } from "@/components/chat/model-picker";
import { AttachButton, AttachmentTray, DropZone, useAttachments } from "@/components/chat/attachments";
import { newAttachmentId, splitAttachments, type Attachment } from "@/lib/attachments";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";


/** The "waiting" row hides while text is arriving or a tool card is already showing progress. */
function isStreaming(turn: Turn | undefined): boolean {
  if (!turn) return false;
  if (turn.role === "tool") return turn.status !== "done" && turn.status !== "failed" && turn.status !== "denied";
  return Boolean(turn.streaming);
}


/** What a blank conversation says before the first message, worded for its kind. */
function EmptyState({ space, provider, model }: { space?: string; provider?: string; model: string }) {
  if (space) {
    return (
      <div className="pt-6">
        <h1 className="text-display">Working in {space}</h1>
        <p className="mt-3 max-w-[52ch] text-lead text-slate">
          Ask about the files here, or say what you want changed. Photon lists, searches, reads and edits inside this
          folder and nowhere else, and asks before it writes or runs a command. Every step shows up here.
        </p>
        <p className="mt-6 text-small text-slate">
          Replies come from {provider} with <span className="font-mono">{model}</span>. Change that below.
        </p>
      </div>
    );
  }
  return (
    <div className="pt-6">
      <h1 className="text-display">What are we working on?</h1>
      <p className="mt-3 max-w-[52ch] text-lead text-slate">
        A plain conversation, not tied to a folder. Good for questions, drafts and thinking out loud. To work on files,
        start a chat from the Space tab.
      </p>
      <p className="mt-6 text-small text-slate">
        Replies come from {provider} with <span className="font-mono">{model}</span>. Change that below.
      </p>
    </div>
  );
}

/**
 * One chat. `/chat` is a blank draft, `/space/chat` a blank draft in the
 * active workspace; the first send creates the chat and moves to
 * `/chat/:chatId`. Turns and in-flight state live in ChatsProvider.
 */
export function ChatPage({ inSpace = false }: { inSpace?: boolean }) {
  const { chatId, workspaceId } = useParams<{ chatId: string; workspaceId: string }>();
  const navigate = useNavigate();
  const { call, user } = useAuth();
  const chats = useChats();
  const chat = chatId ? chats.get(chatId) : undefined;
  const { skills } = useSkills();

  const providers = useAsync(() => call((t) => window.photon.listProviders(t)), [user?.id]);
  const workspaces = useAsync(() => call((t) => window.photon.listWorkspaces(t)), [user?.id]);
  // `location.key` changes on every navigation, so picking a new space while already on /space/chat re-reads it.
  const location = useLocation();
  const active = useAsync(() => call((t) => window.photon.getActiveWorkspace(t)), [user?.id, location.key]);

  // The space this chat runs in: the saved one, the one named in the URL, or the active workspace for a new space draft.
  const spaceId = chat ? chat.spaceId : inSpace ? (workspaceId ?? active.data?.id) : undefined;
  const space = spaceId ? workspaces.data?.find((w) => w.id === spaceId) : undefined;
  const [explorerOpen, toggleExplorer] = useStoredFlag("photon.chat.explorerOpen", true);

  // A saved conversation owns its provider and model; a draft keeps them locally until the first send.
  const [draftPick, setDraftPick] = React.useState<Pick | null>(null);
  const ready = React.useMemo(() => providers.data?.filter((p) => p.has_key) ?? [], [providers.data]);
  const { current, model } = resolveModel(ready, chat ? { provider: chat.provider, model: chat.model } : draftPick);

  const [draft, setDraft] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  // Follow the reply only while the user is at the bottom. Scrolling up mid-answer
  // unpins the view; scrolling back down (or sending) pins it again.
  const pinned = React.useRef(true);
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  // Dictation appends to whatever is already typed; it needs a provider that does speech to text.
  const { toast } = useToast();
  const engineSetting = useAsync(() => call((t) => window.photon.getSetting(t, DICTATION_ENGINE_KEY)), [user?.id]);
  const engine: DictationEngine = engineSetting.data === "cloud" ? "cloud" : "local";
  const canDictate = engine === "local" || ready.some((p) => p.capabilities.includes("transcription"));
  const dictation = useDictation(
    engine,
    (text) => setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, "")} ${text}` : text)),
    (message) => toast(message, "error"),
  );

  // Attachments go with plain chats only: workspace chats run on the server-side agent, which takes text.
  const plain = !spaceId;
  const attachments = useAttachments((message) => toast(message, "error"));
  const sendRef = React.useRef<(text: string, extra?: Attachment[]) => void>(() => undefined);

  // An annotated screenshot from the overlay arrives as navigation state on /chat.
  const annotation = (location.state as { annotation?: AppAnnotation } | null)?.annotation;
  React.useEffect(() => {
    if (!annotation) return;
    const item: Attachment = { id: newAttachmentId(), kind: "image", name: "Annotated screen", image: annotation.image };
    // Consume the state so a re-render or Back doesn't attach it twice.
    navigate(location.pathname, { replace: true, state: null });
    if (annotation.note) sendRef.current(annotation.note, [item]);
    else attachments.add([item]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const turns = chat?.turns ?? [];
  const initials = (user?.first_name?.[0] ?? user?.email[0] ?? "?").toUpperCase();
  const busy = chatId ? chats.isBusy(chatId) : false;
  const error = chatId ? chats.errorOf(chatId) : null;

  React.useEffect(() => {
    if (pinned.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  // A deleted or unknown chat id falls back to a fresh draft.
  if (chatId && !chat) return <Navigate to="/chat" replace />;
  // A space draft needs a workspace; send the user to pick one.
  if (inSpace && !workspaceId && !active.loading && !active.data) return <Navigate to="/" replace />;
  // A workspace id that no longer exists falls back to the active one.
  if (workspaceId && workspaces.data && !workspaces.data.some((w) => w.id === workspaceId)) {
    return <Navigate to="/space/chat" replace />;
  }

  function send(text: string, extra: Attachment[] = []) {
    const typed = text.trim();
    const items = plain ? [...attachments.items, ...extra] : [];
    if (!current) {
      // Providers still loading: keep what arrived so nothing is lost.
      if (extra.length) attachments.add(extra);
      if (typed) setDraft(typed);
      return;
    }
    if ((!typed && !items.length) || busy) return;
    if (inSpace && !spaceId) return;
    // `/name args` becomes a skill invocation when the user has a skill by that name.
    const { skill, content } = parseInvocation(typed, skills);
    const { images, files } = splitAttachments(items);
    setDraft("");
    attachments.clear();
    pinned.current = true;
    const id = chats.send(chatId ?? null, content, { provider: current.provider, model, spaceId, skill, images, files });
    if (!chatId) navigate(`/chat/${id}`, { replace: true });
  }
  sendRef.current = send;

  function attachFiles(files: File[]) {
    if (plain) void attachments.addFiles(files);
    else toast("Attachments work in plain chats. Start one from the Chat tab.", "error");
  }

  function onPick(provider: string, m: string) {
    if (chatId) chats.setModel(chatId, provider, m);
    else setDraftPick({ provider, model: m });
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {space && (
        <HeaderActions>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleExplorer}
            aria-pressed={explorerOpen}
            aria-label={explorerOpen ? "Hide folder" : "Show folder"}
          >
            <SidebarSimple weight={explorerOpen ? "fill" : "bold"} className="rotate-180" />
            {space.name}
          </Button>
        </HeaderActions>
      )}
      {/* @container: padding and bubble widths follow this column, not the window, since the folder panel takes a share. */}
      <DropZone className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col" onFiles={attachFiles}>
        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-8 @2xl:px-14">
          <div className="flex flex-col gap-7">
            {!providers.loading && !ready.length && (
              <Alert variant="problem">
                <AlertDescription>
                  No provider has an API key yet.{" "}
                  <Link
                    to="/settings/providers"
                    className="underline decoration-input underline-offset-4 hover:decoration-black"
                  >
                    Add one in Settings
                  </Link>
                  , then come back here.
                </AlertDescription>
              </Alert>
            )}
            {!turns.length && ready.length > 0 && (
              <EmptyState space={space?.name} provider={current?.name} model={model} />
            )}
            {turns.map((t, i) =>
              t.role === "tool" ? (
                // Approval buttons only work while this chat's turn is in flight.
                <ToolTurnCard
                  key={t.callId}
                  turn={t}
                  onDecide={busy && chatId ? (callId, decision) => chats.approve(chatId, callId, decision) : undefined}
                />
              ) : t.role === "user" ? (
                <UserTurn key={i} turn={t} initials={initials} />
              ) : (
                <AssistantTurn key={i} turn={t} />
              ),
            )}
            {busy && !isStreaming(turns[turns.length - 1]) && <PendingTurn from={current?.name} />}
            {error && (
              <Alert variant="problem">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => send(draft)}
          canSend={Boolean(draft.trim()) || (plain && attachments.items.length > 0)}
          leading={plain ? <AttachButton onFiles={attachFiles} disabled={busy} /> : undefined}
          attachments={plain ? <AttachmentTray items={attachments.items} onRemove={attachments.remove} /> : undefined}
          onPaste={plain ? attachments.onPaste : undefined}
          onStop={busy && chatId ? () => chats.stop(chatId) : undefined}
          disabled={!ready.length || busy}
          placeholder={ready.length ? (skills.length ? "Ask something, or / for a skill" : "Ask something") : "Add an API key first"}
          dictation={canDictate ? dictation : undefined}
          skills={skills}
          footer={
            <ModelPicker
              providers={ready}
              current={current}
              model={model}
              loading={providers.loading}
              onPick={onPick}
            />
          }
        />
      </DropZone>
      {space && explorerOpen && <FolderExplorer workspaceId={space.id} name={space.name} onCollapse={toggleExplorer} />}
    </div>
  );
}
