import * as React from "react";
import type { ChatMessage, CompletionEvent } from "../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/utils";

export type Turn = ChatMessage & {
  /** When the turn was sent or received, epoch ms. Older saved turns may lack it. */
  at?: number;
  /** True while the reply is still arriving; never persisted as true. */
  streaming?: boolean;
  meta?: {
    provider: string;
    model: string;
    /** Prompt and completion tokens as the provider reported them; `tokens` is the total. */
    inputTokens?: number;
    outputTokens?: number;
    tokens?: number;
    call_id: string;
  };
};

export type Chat = {
  id: string;
  title: string;
  turns: Turn[];
  /** Provider and model this conversation uses; changed from the picker, applied to the next send. */
  provider: string;
  model: string;
  /** Workspace the chat runs in; unset for a free-standing chat on the Chat tab. */
  spaceId?: string;
  /** Set once the user renames the chat; the title then stops following the first message. */
  titleLocked?: boolean;
  createdAt: number;
  updatedAt: number;
};

type SendOptions = { provider: string; model: string; spaceId?: string };

type ChatsContextValue = {
  chats: Chat[];
  get: (id: string) => Chat | undefined;
  /** Send a message. `id` null starts a new chat; returns the chat id either way. */
  send: (id: string | null, content: string, opts: SendOptions) => string;
  isBusy: (id: string) => boolean;
  /** Cancels the reply in flight for a chat; whatever arrived so far stays. */
  stop: (id: string) => void;
  errorOf: (id: string) => string | null;
  /** Changes the provider and model an existing conversation will use from now on. */
  setModel: (id: string, provider: string, model: string) => void;
  clear: (id: string) => void;
  remove: (id: string) => void;
  /** Gives the chat a fixed title; an empty title unlocks it again. */
  rename: (id: string, title: string) => void;
};

const ChatsContext = React.createContext<ChatsContextValue | null>(null);

const STORAGE_PREFIX = "photon.chats.";
const TITLE_MAX = 48;
const SYSTEM_PROMPT = "You are Photon, a concise assistant embedded in a desktop app. Answer plainly.";

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

function readChats(userId: string): Chat[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as Chat[]) : [];
  } catch {
    return [];
  }
}

function writeChats(userId: string, chats: Chat[]) {
  try {
    // A reload mid-answer must not leave a turn stuck in the streaming state.
    const settled = chats.map((c) => ({ ...c, turns: c.turns.map(({ streaming: _, ...t }) => t) }));
    window.localStorage.setItem(storageKey(userId), JSON.stringify(settled));
  } catch {
    // Storage full or unavailable; the in-memory copy still works for this session.
  }
}

function newId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Title from the first user message: first line, trimmed to a sidebar-sized length. */
function titleFor(turns: Turn[]): string {
  const first =
    turns
      .find((t) => t.role === "user")
      ?.content.trim()
      .split("\n")[0] ?? "";
  if (!first) return "New chat";
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1)}…` : first;
}

/**
 * Chats live in the renderer for now, one localStorage entry per user, newest
 * first. The server does not know about them yet; when it does, this is the
 * only place that changes.
 *
 * The provider also owns in-flight requests, so navigating between chats (or
 * from /chat to /chat/:id on first send) never drops a pending reply.
 */
export function ChatsProvider({ children }: { children: React.ReactNode }) {
  const { user, call } = useAuth();
  const userId = user?.id ?? null;
  const [chats, setChats] = React.useState<Chat[]>(() => (userId ? readChats(userId) : []));
  const [busy, setBusy] = React.useState<Record<string, true>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  /** streamId -> handler for that stream's events. */
  const pendingStreams = React.useRef(new Map<string, (event: CompletionEvent) => void>());
  /** chatId -> streamId currently answering it, for `stop`. */
  const activeStreams = React.useRef(new Map<string, string>());

  React.useEffect(
    () => window.photon.onCompletionEvent((streamId, event) => pendingStreams.current.get(streamId)?.(event)),
    [],
  );

  // Swap the list when the signed-in user changes.
  React.useEffect(() => {
    setChats(userId ? readChats(userId) : []);
    setBusy({});
    setErrors({});
  }, [userId]);

  React.useEffect(() => {
    if (userId) writeChats(userId, chats);
  }, [userId, chats]);

  const get = React.useCallback((id: string) => chats.find((c) => c.id === id), [chats]);

  const patchTurns = React.useCallback((id: string, fn: (prev: Turn[]) => Turn[]) => {
    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const turns = fn(c.turns);
        return { ...c, turns, title: c.titleLocked ? c.title : titleFor(turns), updatedAt: Date.now() };
      }),
    );
  }, []);

  const send = React.useCallback(
    (id: string | null, content: string, opts: SendOptions) => {
      const userTurn: Turn = { role: "user", content, at: Date.now() };
      let chatId = id;
      let history: Turn[];

      if (chatId) {
        history = [...(chats.find((c) => c.id === chatId)?.turns ?? []), userTurn];
        const target = chatId;
        // The model used for this send is the one the conversation keeps.
        setChats((prev) =>
          prev.map((c) =>
            c.id === target
              ? {
                  ...c,
                  turns: history,
                  title: titleFor(history),
                  provider: opts.provider,
                  model: opts.model,
                  updatedAt: Date.now(),
                }
              : c,
          ),
        );
      } else {
        const now = Date.now();
        chatId = newId();
        history = [userTurn];
        const chat: Chat = {
          id: chatId,
          title: titleFor(history),
          turns: history,
          ...opts,
          createdAt: now,
          updatedAt: now,
        };
        setChats((prev) => [chat, ...prev]);
      }

      const target = chatId;
      setErrors((e) => ({ ...e, [target]: "" }));
      setBusy((b) => ({ ...b, [target]: true }));

      // One stream per send. The reply grows in place as deltas arrive; the
      // assistant turn is only added once the provider has started answering.
      const streamId = newId();
      let started = false;
      const handlers = {
        start(ev: Extract<CompletionEvent, { type: "start" }>) {
          started = true;
          patchTurns(target, (prev) => [
            ...prev,
            { role: "assistant", content: "", at: Date.now(), streaming: true, meta: { ...ev, call_id: "" } },
          ]);
        },
        delta(ev: Extract<CompletionEvent, { type: "delta" }>) {
          patchTurns(target, (prev) => {
            const last = prev[prev.length - 1];
            if (!last?.streaming) return prev;
            return [...prev.slice(0, -1), { ...last, content: last.content + ev.text }];
          });
        },
        done(ev: Extract<CompletionEvent, { type: "done" }>) {
          patchTurns(target, (prev) => {
            const last = prev[prev.length - 1];
            if (!last?.streaming) return prev;
            const meta = {
              provider: ev.provider,
              model: ev.model,
              inputTokens: ev.usage.input_tokens,
              outputTokens: ev.usage.output_tokens,
              tokens: ev.usage.total_tokens,
              call_id: ev.call_id,
            };
            return [...prev.slice(0, -1), { ...last, streaming: false, meta }];
          });
        },
        error(ev: Extract<CompletionEvent, { type: "error" }>) {
          setErrors((e) => ({ ...e, [target]: ev.message }));
        },
      };
      pendingStreams.current.set(streamId, (event) => {
        // The union narrows per branch; the cast keeps each handler typed to its own event.
        (handlers[event.type] as (ev: CompletionEvent) => void)(event);
      });
      activeStreams.current.set(target, streamId);

      void (async () => {
        try {
          await call((t) =>
            window.photon.streamCompletion(t, streamId, {
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...history.map(({ role, content }) => ({ role, content })),
              ],
              provider: opts.provider,
              model: opts.model,
              task_key: "chat",
            }),
          );
        } catch (err) {
          setErrors((e) => ({ ...e, [target]: errorMessage(err) }));
        } finally {
          pendingStreams.current.delete(streamId);
          if (activeStreams.current.get(target) === streamId) activeStreams.current.delete(target);
          // A stream that ended without `done` (cancel, disconnect) keeps its partial text but stops pulsing.
          if (started) {
            patchTurns(target, (prev) => {
              const last = prev[prev.length - 1];
              return last?.streaming ? [...prev.slice(0, -1), { ...last, streaming: false }] : prev;
            });
          }
          setBusy((b) => {
            const { [target]: _, ...rest } = b;
            return rest;
          });
        }
      })();

      return target;
    },
    [call, chats, patchTurns],
  );

  const stop = React.useCallback((id: string) => {
    const streamId = activeStreams.current.get(id);
    if (streamId) void window.photon.cancelCompletion(streamId);
  }, []);

  const isBusy = React.useCallback((id: string) => Boolean(busy[id]), [busy]);
  const errorOf = React.useCallback((id: string) => errors[id] || null, [errors]);

  const setModel = React.useCallback((id: string, provider: string, model: string) => {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, provider, model } : c)));
  }, []);

  const clear = React.useCallback(
    (id: string) => {
      patchTurns(id, () => []);
      setErrors((e) => ({ ...e, [id]: "" }));
    },
    [patchTurns],
  );

  const remove = React.useCallback((id: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const rename = React.useCallback((id: string, title: string) => {
    const next = title.trim();
    setChats((prev) =>
      prev.map((c) =>
        c.id !== id
          ? c
          : next
            ? { ...c, title: next, titleLocked: true }
            : { ...c, title: titleFor(c.turns), titleLocked: false },
      ),
    );
  }, []);

  const value = React.useMemo(
    () => ({ chats, get, send, stop, isBusy, errorOf, setModel, clear, remove, rename }),
    [chats, get, send, stop, isBusy, errorOf, setModel, clear, remove, rename],
  );

  return <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>;
}

export function useChats() {
  const ctx = React.useContext(ChatsContext);
  if (!ctx) throw new Error("useChats must be used within ChatsProvider");
  return ctx;
}
