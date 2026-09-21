import * as React from "react";
import { Check, Copy } from "@phosphor-icons/react";

import type { Turn } from "@/hooks/use-chats";
import { useToast } from "@/hooks/use-toast";
import { Markdown } from "@/components/chat/markdown";

function Avatar({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sheet font-mono text-small text-foreground">
      {children}
    </span>
  );
}

/** Photon's mark, used as the assistant avatar. */
function PhotonAvatar() {
  return (
    <Avatar>
      <span className="size-2.5 rotate-45 rounded-[2px] bg-black" aria-hidden="true" />
    </Avatar>
  );
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function isToday(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/** Time only for today's messages, date and time for older ones. */
function TurnTime({ at }: { at?: number }) {
  if (at == null) return null;
  return (
    <time dateTime={new Date(at).toISOString()} title={dateTimeFmt.format(at)}>
      {isToday(at) ? timeFmt.format(at) : dateTimeFmt.format(at)}
    </time>
  );
}

function CopyButton({ text }: { text: string }) {
  const { toast } = useToast();
  const [done, setDone] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1500);
    } catch {
      toast("Could not copy", "error");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={done ? "Copied" : "Copy message"}
      className="flex size-6 items-center justify-center rounded-md text-slate transition-opacity hover:bg-sheet hover:text-foreground focus-visible:opacity-100 md:opacity-0 md:group-hover/turn:opacity-100"
    >
      {done ? <Check weight="bold" className="size-3.5" /> : <Copy weight="bold" className="size-3.5" />}
    </button>
  );
}

/** Model and token counts for a reply: "in" and "out" separately when the provider reports them. */
function UsageLine({ meta }: { meta: NonNullable<Turn["meta"]> }) {
  const parts: string[] = [];
  if (meta.inputTokens != null) parts.push(`${meta.inputTokens} in`);
  if (meta.outputTokens != null) parts.push(`${meta.outputTokens} out`);
  if (!parts.length && meta.tokens != null) parts.push(`${meta.tokens} tokens`);
  return (
    <span className="text-micro">
      {meta.model}
      {parts.length > 0 && ` · ${parts.join(", ")}`}
    </span>
  );
}

/** Time and copy action under a message; aligned to the bubble's side. */
function TurnMeta({ turn, align, children }: { turn: Turn; align: "left" | "right"; children?: React.ReactNode }) {
  return (
    <div
      className={`mt-1 flex items-center gap-2 font-mono text-micro text-slate ${align === "right" ? "flex-row-reverse" : ""}`}
    >
      <TurnTime at={turn.at} />
      {children}
      <CopyButton text={turn.content} />
    </div>
  );
}

export function UserTurn({ turn, initials }: { turn: Turn; initials: string }) {
  return (
    <div className="group/turn ml-auto flex max-w-[75%] items-start gap-3">
      <div className="min-w-0">
        <p className="rounded-lg bg-sheet px-4 py-3 whitespace-pre-wrap">{turn.content}</p>
        <TurnMeta turn={turn} align="right" />
      </div>
      <Avatar>{initials}</Avatar>
    </div>
  );
}

export function AssistantTurn({ turn }: { turn: Turn }) {
  return (
    <div className="group/turn mr-auto flex max-w-[75%] items-start gap-3">
      <PhotonAvatar />
      <div className="min-w-0">
        <div className="rounded-lg border border-input px-4 py-3" aria-busy={turn.streaming || undefined}>
          <Markdown>{turn.content}</Markdown>
          {turn.streaming && <span className="caret inline-block h-0 align-baseline" aria-hidden="true" />}
        </div>
        {/* Time, usage and copy wait for the full reply. */}
        {!turn.streaming && (
          <TurnMeta turn={turn} align="left">
            {turn.meta && <UsageLine meta={turn.meta} />}
          </TurnMeta>
        )}
      </div>
    </div>
  );
}

/** Placeholder row while a reply is in flight. */
export function PendingTurn({ from }: { from?: string }) {
  return (
    <div className="mr-auto flex items-start gap-3">
      <PhotonAvatar />
      <p className="py-2 text-slate">Waiting for {from}</p>
    </div>
  );
}
