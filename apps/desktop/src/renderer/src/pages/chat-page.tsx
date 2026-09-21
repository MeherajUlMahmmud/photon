import * as React from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Broom, SidebarSimple } from "@phosphor-icons/react";
import type { LlmProvider } from "../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { useAsync } from "@/hooks/use-async";
import { useChats } from "@/hooks/use-chats";
import { useStoredFlag } from "@/hooks/use-stored-flag";
import { FolderExplorer } from "@/components/layout/folder-explorer";
import { AssistantTurn, PendingTurn, UserTurn } from "@/components/chat/turn";
import { Composer } from "@/components/chat/composer";
import { ModelPicker } from "@/components/chat/model-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Pick = { provider: string; model: string };

/**
 * Resolves the provider and model to use from a pick that may be stale: the
 * picked provider may have lost its key, or the model id may be empty.
 */
function resolveModel(ready: LlmProvider[], pick: Pick | null) {
  const current = ready.find((p) => p.provider === pick?.provider) ?? ready[0];
  const model =
    current && pick?.provider === current.provider && pick.model ? pick.model : (current?.default_model ?? "");
  return { current, model };
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
  const endRef = React.useRef<HTMLDivElement>(null);

  const turns = chat?.turns ?? [];
  const initials = (user?.first_name?.[0] ?? user?.email[0] ?? "?").toUpperCase();
  const busy = chatId ? chats.isBusy(chatId) : false;
  const error = chatId ? chats.errorOf(chatId) : null;

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  // A deleted or unknown chat id falls back to a fresh draft.
  if (chatId && !chat) return <Navigate to="/chat" replace />;
  // A space draft needs a workspace; send the user to pick one.
  if (inSpace && !workspaceId && !active.loading && !active.data) return <Navigate to="/" replace />;
  // A workspace id that no longer exists falls back to the active one.
  if (workspaceId && workspaces.data && !workspaces.data.some((w) => w.id === workspaceId)) {
    return <Navigate to="/space/chat" replace />;
  }

  function send() {
    const content = draft.trim();
    if (!content || busy || !current) return;
    if (inSpace && !spaceId) return;
    setDraft("");
    const id = chats.send(chatId ?? null, content, { provider: current.provider, model, spaceId });
    if (!chatId) navigate(`/chat/${id}`, { replace: true });
  }

  function onPick(provider: string, m: string) {
    if (chatId) chats.setModel(chatId, provider, m);
    else setDraftPick({ provider, model: m });
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
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
                <UserTurn key={i} turn={t} initials={initials} />
              ) : (
                <AssistantTurn key={i} turn={t} />
              ),
            )}
            {busy && <PendingTurn from={current?.name} />}
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
          onSend={send}
          disabled={!ready.length || busy}
          placeholder={ready.length ? "Ask something" : "Add an API key first"}
          actions={
            ((chatId && turns.length > 0) || space) && (
              <>
                {chatId && turns.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => chats.clear(chatId)} disabled={busy}>
                    <Broom weight="bold" />
                    Clear conversation
                  </Button>
                )}
                {space && (
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
                )}
              </>
            )
          }
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
      </div>
      {space && explorerOpen && <FolderExplorer workspaceId={space.id} name={space.name} />}
    </div>
  );
}
