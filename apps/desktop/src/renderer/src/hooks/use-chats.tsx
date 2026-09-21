import * as React from "react";
import type { ChatMessage } from "../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/utils";

export type Turn = ChatMessage & {
  meta?: { provider: string; model: string; tokens?: number; call_id: string };
};

export type Chat = {
  id: string;
  title: string;
  turns: Turn[];
  /** Provider and model the chat was started with; the page reuses them on reopen. */
  provider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
};

type SendOptions = { provider: string; model: string };

type ChatsContextValue = {
  chats: Chat[];
  get: (id: string) => Chat | undefined;
  /** Send a message. `id` null starts a new chat; returns the chat id either way. */
  send: (id: string | null, content: string, opts: SendOptions) => string;
  isBusy: (id: string) => boolean;
  errorOf: (id: string) => string | null;
  clear: (id: string) => void;
  remove: (id: string) => void;
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
    window.localStorage.setItem(storageKey(userId), JSON.stringify(chats));
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
        return { ...c, turns, title: titleFor(turns), updatedAt: Date.now() };
      }),
    );
  }, []);

  const send = React.useCallback(
    (id: string | null, content: string, opts: SendOptions) => {
      const userTurn: Turn = { role: "user", content };
      let chatId = id;
      let history: Turn[];

      if (chatId) {
        history = [...(chats.find((c) => c.id === chatId)?.turns ?? []), userTurn];
        patchTurns(chatId, () => history);
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

      void (async () => {
        try {
          const out = await call((t) =>
            window.photon.createCompletion(t, {
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...history.map(({ role, content }) => ({ role, content })),
              ],
              provider: opts.provider,
              model: opts.model,
              task_key: "chat",
            }),
          );
          patchTurns(target, (prev) => [
            ...prev,
            {
              role: "assistant",
              content: out.content,
              meta: {
                provider: out.provider,
                model: out.model,
                tokens: out.usage.total_tokens,
                call_id: out.call_id,
              },
            },
          ]);
        } catch (err) {
          setErrors((e) => ({ ...e, [target]: errorMessage(err) }));
        } finally {
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

  const isBusy = React.useCallback((id: string) => Boolean(busy[id]), [busy]);
  const errorOf = React.useCallback((id: string) => errors[id] || null, [errors]);

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

  const value = React.useMemo(
    () => ({ chats, get, send, isBusy, errorOf, clear, remove }),
    [chats, get, send, isBusy, errorOf, clear, remove],
  );

  return <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>;
}

export function useChats() {
  const ctx = React.useContext(ChatsContext);
  if (!ctx) throw new Error("useChats must be used within ChatsProvider");
  return ctx;
}
