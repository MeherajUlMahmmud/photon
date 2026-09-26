import * as React from "react";
import type { AgentEvent, ApprovalDecision, ChatImage, ChatMessage, CompletionEvent, ToolRisk } from "../../../preload/api";
import type { AttachedFile } from "@/lib/attachments";

import { useAuth } from "@/hooks/use-auth";
import { invocationLabel } from "@/lib/skills";
import { withFiles } from "@/lib/attachments";
import { errorMessage } from "@/lib/utils";

export type { AttachedFile };

/**
 * A user message or an assistant reply. A user turn that invoked a skill
 * keeps `skill` (its name) and `content` (the arguments only); the server
 * splices the skill's instructions in on every send.
 */
export type TextTurn = ChatMessage & {
  /** When the turn was sent or received, epoch ms. Older saved turns may lack it. */
  at?: number;
  /** True while the reply is still arriving; never persisted as true. */
  streaming?: boolean;
  /** Text files attached to a user message (plain chats); resent with it on every request. */
  files?: AttachedFile[];
  /** Images are kept in memory only; once saved, a turn remembers how many it had. */
  imageCount?: number;
  /** Which model step of the agent turn produced this reply (workspace chats only). */
  step?: number;
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

/**
 * Where a tool call is in its life. `pending` = announced, not started;
 * `awaiting_approval` = the user must click Allow or Deny; `denied` = they
 * clicked Deny (the model is told); `failed` = the tool threw.
 */
export type ToolStatus = "pending" | "awaiting_approval" | "running" | "done" | "failed" | "denied";

/**
 * One tool call the model made in a workspace chat: what it asked for, what
 * came back, how long it took. Rendered as a card between assistant replies.
 */
export type ToolTurn = {
  role: "tool";
  at?: number;
  callId: string;
  name: string;
  input: Record<string, unknown>;
  risk: ToolRisk;
  status: ToolStatus;
  /** The model step that asked for this call. */
  step: number;
  /** Exactly what went back to the model. */
  output?: string;
  error?: string;
  durationMs?: number;
};

export type Turn = TextTurn | ToolTurn;

export type Chat = {
  id: string;
  title: string;
  turns: Turn[];
  /** Provider and model this conversation uses; changed from the picker, applied to the next send. */
  provider: string;
  model: string;
  /** Workspace the chat runs in; unset for a free-standing chat on the Chat tab. */
  spaceId?: string;
  /**
   * Server-side agent session backing a workspace chat. Created on the first
   * send; the server owns the transcript from then on and this store keeps a
   * mirror for display.
   */
  sessionId?: string;
  /** "provider/model" the session is currently pinned to, so a picker change is pushed before the next send. */
  sessionPin?: string;
  /** Set once the user renames the chat; the title then stops following the first message. */
  titleLocked?: boolean;
  createdAt: number;
  updatedAt: number;
};

type SendOptions = {
  provider: string;
  model: string;
  spaceId?: string;
  /** Name of the skill the message invokes; `content` is then its arguments and may be empty. */
  skill?: string;
  /** Plain chats only: images for this message (sent once, never saved) and text files (kept with the turn). */
  images?: ChatImage[];
  files?: AttachedFile[];
};

type ChatsContextValue = {
  chats: Chat[];
  get: (id: string) => Chat | undefined;
  /** Send a message. `id` null starts a new chat; returns the chat id either way. */
  send: (id: string | null, content: string, opts: SendOptions) => string;
  isBusy: (id: string) => boolean;
  /** Cancels the reply in flight for a chat; whatever arrived so far stays. */
  stop: (id: string) => void;
  /** Answers a tool call that is `awaiting_approval`. */
  approve: (id: string, callId: string, decision: ApprovalDecision) => void;
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
    // A reload mid-answer must not leave a turn stuck in the streaming state,
    // nor a tool call that looks like it is still running or waiting on a click.
    const settled = chats.map((c) => ({ ...c, turns: c.turns.map(settleTurn) }));
    window.localStorage.setItem(storageKey(userId), JSON.stringify(settled));
  } catch {
    // Storage full or unavailable; the in-memory copy still works for this session.
  }
}

/** The persisted form of a turn: nothing in flight. */
function settleTurn(t: Turn): Turn {
  if (t.role === "tool") {
    return t.status === "done" || t.status === "failed" || t.status === "denied"
      ? t
      : { ...t, status: "failed", error: t.error || "Interrupted before it finished" };
  }
  // Screenshots and pictures never reach storage; the turn keeps a count so the history can say so.
  const { streaming: _, images, ...rest } = t;
  return images?.length ? { ...rest, imageCount: images.length } : rest;
}


function newId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Title from the first user message: first line, trimmed to a sidebar-sized length. */
function titleFor(turns: Turn[]): string {
  const userTurn = turns.find((t): t is TextTurn => t.role === "user");
  const first = userTurn ? invocationLabel(userTurn.skill, userTurn.content).trim().split("\n")[0] ?? "" : "";
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
  /** turnId -> handler for that agent turn's events. */
  const pendingTurns = React.useRef(new Map<string, (event: AgentEvent) => void>());
  /** chatId -> streamId (plain chat) or turnId (workspace chat) currently answering it, for `stop`. */
  const activeStreams = React.useRef(new Map<string, string>());

  React.useEffect(
    () => window.photon.onCompletionEvent((streamId, event) => pendingStreams.current.get(streamId)?.(event)),
    [],
  );
  React.useEffect(() => window.photon.onAgentEvent((turnId, event) => pendingTurns.current.get(turnId)?.(event)), []);

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

  /**
   * A workspace chat turn. The server runs the model, main runs the tools; this
   * only mirrors what happens into turns so the user sees every step:
   *
   *   start       -> a new assistant bubble for this model step
   *   delta       -> text grows in place
   *   step_done   -> bubble settles with usage; an empty bubble (the model went
   *                  straight to tools) is dropped
   *   tool_call   -> a tool card, status "pending"
   *   approval_needed / tool_running / tool_result -> the card's status, output, timing
   *   done        -> the turn is over (`max_steps` is surfaced as an error)
   *   error       -> shown under the transcript; whatever arrived stays
   */
  const runAgent = React.useCallback(
    (target: string, content: string, spaceId: string, opts: SendOptions) => {
      const turnId = newId();
      let step = 0;

      const patchTool = (callId: string, fn: (t: ToolTurn) => ToolTurn) =>
        patchTurns(target, (prev) => prev.map((t) => (t.role === "tool" && t.callId === callId ? fn(t) : t)));

      // The assistant bubble for the current step is always the last streaming text turn.
      const settleAssistant = (fn: (t: TextTurn) => TextTurn | null) =>
        patchTurns(target, (prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role === "tool" || !last.streaming) return prev;
          const next = fn(last);
          return next ? [...prev.slice(0, -1), next] : prev.slice(0, -1);
        });

      const handlers: { [K in AgentEvent["type"]]: (ev: Extract<AgentEvent, { type: K }>) => void } = {
        start(ev) {
          step = ev.step;
          patchTurns(target, (prev) => [
            ...prev,
            {
              role: "assistant",
              content: "",
              at: Date.now(),
              streaming: true,
              step: ev.step,
              meta: { provider: ev.provider, model: ev.model, call_id: "" },
            },
          ]);
        },
        delta(ev) {
          settleAssistant((last) => ({ ...last, content: last.content + ev.text }));
        },
        step_done(ev) {
          settleAssistant((last) =>
            last.content
              ? {
                  ...last,
                  streaming: false,
                  meta: {
                    provider: ev.provider,
                    model: ev.model,
                    inputTokens: ev.usage.input_tokens,
                    outputTokens: ev.usage.output_tokens,
                    tokens: ev.usage.total_tokens,
                    call_id: ev.call_id ?? "",
                  },
                }
              : null,
          );
        },
        tool_call(ev) {
          patchTurns(target, (prev) => [
            ...prev,
            { role: "tool", at: Date.now(), callId: ev.call_id, name: ev.name, input: ev.input, risk: ev.risk, status: "pending", step },
          ]);
        },
        approval_needed(ev) {
          patchTool(ev.call_id, (t) => ({ ...t, status: "awaiting_approval" }));
        },
        tool_running(ev) {
          patchTool(ev.call_id, (t) => ({ ...t, status: "running" }));
        },
        tool_result(ev) {
          patchTool(ev.call_id, (t) => ({
            ...t,
            status: ev.denied ? "denied" : ev.ok ? "done" : "failed",
            output: ev.output,
            error: ev.error,
            durationMs: ev.duration_ms,
          }));
        },
        done(ev) {
          if (ev.stop_reason === "max_steps") {
            setErrors((e) => ({ ...e, [target]: "Stopped: this session reached its step limit." }));
          }
        },
        error(ev) {
          setErrors((e) => ({ ...e, [target]: ev.message }));
        },
      };
      pendingTurns.current.set(turnId, (event) => {
        (handlers[event.type] as (ev: AgentEvent) => void)(event);
      });
      activeStreams.current.set(target, turnId);

      void (async () => {
        try {
          // First send creates the session (main adds the folder path and device info);
          // a model change from the picker is pushed to the session before the step.
          const pin = `${opts.provider}/${opts.model}`;
          const existing = chats.find((c) => c.id === target);
          let sessionId = existing?.sessionId;
          if (!sessionId) {
            const session = await call((t) =>
              window.photon.createAgentSession(t, { workspace_id: spaceId, provider: opts.provider, model: opts.model }),
            );
            sessionId = session.id;
            const sid = sessionId;
            setChats((prev) => prev.map((c) => (c.id === target ? { ...c, sessionId: sid, sessionPin: pin } : c)));
          } else if (existing?.sessionPin !== pin) {
            const sid = sessionId;
            await call((t) => window.photon.updateAgentSession(t, sid, { provider: opts.provider, model: opts.model }));
            setChats((prev) => prev.map((c) => (c.id === target ? { ...c, sessionPin: pin } : c)));
          }
          const sid = sessionId;
          await call((t) =>
            window.photon.runAgentTurn(t, turnId, { sessionId: sid, workspaceId: spaceId, content, skill: opts.skill }),
          );
        } catch (err) {
          setErrors((e) => ({ ...e, [target]: errorMessage(err) }));
        } finally {
          pendingTurns.current.delete(turnId);
          if (activeStreams.current.get(target) === turnId) activeStreams.current.delete(target);
          // Anything still in flight after the turn ended (cancel, disconnect) is settled for display.
          patchTurns(target, (prev) => prev.map(settleTurn));
          setBusy((b) => {
            const { [target]: _, ...rest } = b;
            return rest;
          });
        }
      })();
    },
    [call, chats, patchTurns],
  );

  const send = React.useCallback(
    (id: string | null, content: string, opts: SendOptions) => {
      const userTurn: Turn = {
        role: "user",
        content,
        at: Date.now(),
        ...(opts.skill ? { skill: opts.skill } : {}),
        ...(opts.images?.length ? { images: opts.images } : {}),
        ...(opts.files?.length ? { files: opts.files } : {}),
      };
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
          provider: opts.provider,
          model: opts.model,
          spaceId: opts.spaceId,
          createdAt: now,
          updatedAt: now,
        };
        setChats((prev) => [chat, ...prev]);
      }

      const target = chatId;
      setErrors((e) => ({ ...e, [target]: "" }));
      setBusy((b) => ({ ...b, [target]: true }));

      if (opts.spaceId) {
        runAgent(target, content, opts.spaceId, opts);
        return target;
      }

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
            if (last?.role === "tool" || !last?.streaming) return prev;
            return [...prev.slice(0, -1), { ...last, content: last.content + ev.text }];
          });
        },
        done(ev: Extract<CompletionEvent, { type: "done" }>) {
          patchTurns(target, (prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "tool" || !last?.streaming) return prev;
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
                // Plain chats never hold tool turns; the filter keeps the types honest.
                // A skill turn is re-sent as `skill` + arguments so the server expands it again.
                // Files go back every time; images only with the message they were attached to.
                ...history
                  .filter((t): t is TextTurn => t.role !== "tool")
                  .map(({ role, content, skill, files, images }, i, all) => ({
                    role,
                    content: withFiles(content, files),
                    ...(skill ? { skill } : {}),
                    ...(images?.length && i === all.length - 1 ? { images } : {}),
                  })),
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
          if (started) patchTurns(target, (prev) => prev.map(settleTurn));
          setBusy((b) => {
            const { [target]: _, ...rest } = b;
            return rest;
          });
        }
      })();

      return target;
    },
    [call, chats, patchTurns, runAgent],
  );

  const stop = React.useCallback(
    (id: string) => {
      const streamId = activeStreams.current.get(id);
      if (!streamId) return;
      if (pendingTurns.current.has(streamId)) void call((t) => window.photon.cancelAgentTurn(t, streamId));
      else void window.photon.cancelCompletion(streamId);
    },
    [call],
  );

  const approve = React.useCallback((id: string, callId: string, decision: ApprovalDecision) => {
    const turnId = activeStreams.current.get(id);
    if (turnId) void window.photon.approveToolCall(turnId, callId, decision);
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
    () => ({ chats, get, send, stop, approve, isBusy, errorOf, setModel, clear, remove, rename }),
    [chats, get, send, stop, approve, isBusy, errorOf, setModel, clear, remove, rename],
  );

  return <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>;
}

export function useChats() {
  const ctx = React.useContext(ChatsContext);
  if (!ctx) throw new Error("useChats must be used within ChatsProvider");
  return ctx;
}
