import * as React from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowUp, Broom } from "@phosphor-icons/react";
import type { LlmProvider } from "../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { useAsync } from "@/hooks/use-async";
import { useChats } from "@/hooks/use-chats";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function Avatar({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sheet font-mono text-small text-foreground">
      {children}
    </span>
  );
}

/**
 * One chat. `/chat` is a blank draft; the first send creates the chat and
 * moves to `/chat/:chatId`. Turns and in-flight state live in ChatsProvider.
 */
export function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const { call, user } = useAuth();
  const chats = useChats();
  const chat = chatId ? chats.get(chatId) : undefined;

  const providers = useAsync(() => call((t) => window.photon.listProviders(t)), [user?.id]);
  const [providerId, setProviderId] = React.useState<string>(chat?.provider ?? "");
  const [model, setModel] = React.useState<string>(chat?.model ?? "");
  const [draft, setDraft] = React.useState("");
  const endRef = React.useRef<HTMLDivElement>(null);

  const ready = React.useMemo(() => providers.data?.filter((p) => p.has_key) ?? [], [providers.data]);
  const current: LlmProvider | undefined = ready.find((p) => p.provider === providerId) ?? ready[0];

  const turns = chat?.turns ?? [];
  const initials = (user?.first_name?.[0] ?? user?.email[0] ?? "?").toUpperCase();
  const busy = chatId ? chats.isBusy(chatId) : false;
  const error = chatId ? chats.errorOf(chatId) : null;

  React.useEffect(() => {
    if (current && providerId !== current.provider) {
      setProviderId(current.provider);
      setModel(current.default_model);
    }
  }, [current, providerId]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  // A deleted or unknown chat id falls back to a fresh draft.
  if (chatId && !chat) return <Navigate to="/chat" replace />;

  function send() {
    const content = draft.trim();
    if (!content || busy || !current) return;
    setDraft("");
    const id = chats.send(chatId ?? null, content, {
      provider: current.provider,
      model: model || current.default_model,
    });
    if (!chatId) navigate(`/chat/${id}`, { replace: true });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-8 py-8 md:px-14">
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
            <div className="pt-6">
              <h1 className="text-display">What are we working on?</h1>
              <p className="mt-3 text-lead text-slate">
                Plain answers from {current?.name}. Runs that use the workspace come next.
              </p>
            </div>
          )}
          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="ml-auto flex max-w-[75%] items-start gap-3">
                <p className="rounded-lg bg-sheet px-4 py-3 whitespace-pre-wrap">{t.content}</p>
                <Avatar>{initials}</Avatar>
              </div>
            ) : (
              <div key={i} className="mr-auto flex max-w-[75%] items-start gap-3">
                <Avatar>
                  <span className="size-2.5 rotate-45 rounded-[2px] bg-black" aria-hidden="true" />
                </Avatar>
                <div className="rounded-lg border border-input px-4 py-3">
                  <p className="leading-[1.6] whitespace-pre-wrap">{t.content}</p>
                  {t.meta && (
                    <p className="mt-2 font-mono text-small text-slate">
                      {t.meta.model}
                      {t.meta.tokens != null && `, ${t.meta.tokens} tokens`}.
                    </p>
                  )}
                </div>
              </div>
            ),
          )}
          {busy && (
            <div className="mr-auto flex items-start gap-3">
              <Avatar>
                <span className="size-2.5 rotate-45 rounded-[2px] bg-black" aria-hidden="true" />
              </Avatar>
              <p className="py-2 text-slate">Waiting for {current?.name}</p>
            </div>
          )}
          {error && (
            <Alert variant="problem">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="px-8 pb-6 md:px-14">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Select
            value={current?.provider ?? ""}
            onValueChange={(v) => {
              setProviderId(v);
              setModel(ready.find((p) => p.provider === v)?.default_model ?? "");
            }}
            disabled={!ready.length}
          >
            <SelectTrigger size="sm" className="min-w-36">
              <SelectValue placeholder={providers.loading ? "Loading providers" : "No provider has a key"} />
            </SelectTrigger>
            <SelectContent>
              {ready.map((p) => (
                <SelectItem key={p.provider} value={p.provider}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={model} onValueChange={setModel} disabled={!current}>
            <SelectTrigger size="sm" className="min-w-52 font-mono text-small">
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent>
              {(current?.model_ids.length ? current.model_ids : current ? [current.default_model] : []).map((m) => (
                <SelectItem key={m} value={m} className="font-mono text-small">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {chatId && turns.length > 0 && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => chats.clear(chatId)} disabled={busy}>
              <Broom weight="bold" />
              Clear conversation
            </Button>
          )}
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={ready.length ? "Ask something" : "Add an API key first"}
            disabled={!ready.length || busy}
            className="max-h-48 min-h-11 bg-sheet"
            rows={1}
          />
          <Button size="icon" onClick={send} disabled={!draft.trim() || busy || !ready.length} aria-label="Send">
            <ArrowUp weight="bold" />
          </Button>
        </div>
        <p className="mt-2 text-small text-slate">
          <kbd>⌘</kbd> <kbd>Enter</kbd> sends
        </p>
      </div>
    </div>
  );
}
