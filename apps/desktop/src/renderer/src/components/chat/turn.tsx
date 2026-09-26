import * as React from "react";
import { Check, Copy } from "@phosphor-icons/react";

import type { TextTurn } from "@/hooks/use-chats";
import { useToast } from "@/hooks/use-toast";
import { Markdown } from "@/components/chat/markdown";
import { ThinkingPhoton } from "@/components/chat/thinking-photon";
// import { ThinkingRobot } from "@/components/chat/thinking-robot";

function Avatar({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sheet font-mono text-small text-foreground">
      {children}
    </span>
  );
}

/** Photon's mark, used as the assistant avatar. */
export function PhotonAvatar() {
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
function UsageLine({ meta }: { meta: NonNullable<TextTurn["meta"]> }) {
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
function TurnMeta({ turn, align, children }: { turn: TextTurn; align: "left" | "right"; children?: React.ReactNode }) {
  return (
    <div
      className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-micro text-slate *:whitespace-nowrap ${align === "right" ? "flex-row-reverse" : ""}`}
    >
      <TurnTime at={turn.at} />
      {children}
      <CopyButton text={turn.content} />
    </div>
  );
}

/** Images (this session only), a count for images that were not kept, and attached file names. */
function TurnAttachments({ turn }: { turn: TextTurn }) {
  const images = turn.images ?? [];
  const files = turn.files ?? [];
  if (!images.length && !files.length && !turn.imageCount) return null;
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {images.map((img, i) => (
        <img
          key={i}
          src={`data:${img.media_type};base64,${img.data}`}
          alt="Image sent with this message"
          className="h-20 w-auto max-w-full rounded-md border border-border"
        />
      ))}
      {!images.length && turn.imageCount ? (
        <span className="rounded-sm border border-input px-1.5 text-micro text-slate" title="Images are never saved">
          {turn.imageCount} image{turn.imageCount === 1 ? "" : "s"}, not kept
        </span>
      ) : null}
      {files.map((f) => (
        <span key={f.name} className="max-w-full truncate rounded-sm border border-input bg-sheet px-1.5 font-mono text-micro text-slate">
          {f.name}
        </span>
      ))}
    </div>
  );
}

export function UserTurn({ turn, initials }: { turn: TextTurn; initials: string }) {
  return (
    <div className="group/turn ml-auto flex max-w-[90%] animate-rise items-start gap-3 @2xl:max-w-[75%]">
      <div className="min-w-0">
        <TurnAttachments turn={turn} />
        <p className="rounded-lg bg-black/[0.05] px-4 py-3 whitespace-pre-wrap">
          {/* A skill invocation shows as the command it was typed as; the instructions live on the server. */}
          {turn.skill && (
            <span className="mr-2 inline-block rounded border border-input px-1.5 font-mono text-small leading-[1.6]" title="Skill">
              /{turn.skill}
            </span>
          )}
          {turn.content}
        </p>
        <TurnMeta turn={turn} align="right" />
      </div>
      <Avatar>{initials}</Avatar>
    </div>
  );
}

export function AssistantTurn({ turn }: { turn: TextTurn }) {
  return (
    <div className="group/turn mr-auto flex max-w-[90%] animate-rise items-end gap-3 @2xl:max-w-[75%]">
      {/* The mark sits at the foot of the reply, level with its time and usage line. */}
      <PhotonAvatar />
      <div className="min-w-0">
        <div className="rounded-lg border border-input bg-sheet px-4 py-3" aria-busy={turn.streaming || undefined}>
          <Markdown>{turn.content}</Markdown>
          {turn.streaming && <span className="caret inline-block h-0 align-baseline" aria-hidden="true" />}
        </div>
        {/* Time, usage and copy wait for the full reply. */}
        {!turn.streaming && (
          <TurnMeta turn={turn} align="left">
            {turn.step != null && <span className="text-micro">step {turn.step}</span>}
            {turn.meta && <UsageLine meta={turn.meta} />}
          </TurnMeta>
        )}
      </div>
    </div>
  );
}

/**
 * Placeholder row while a reply is in flight: a photon travelling along a
 * light wave, no text. The provider name is only for screen readers. Static
 * under reduced motion. (The pacing robot is kept in thinking-robot.tsx; swap
 * the component to bring it back.)
 */
export function PendingTurn({ from }: { from?: string }) {
  return (
    <div className="mr-auto flex animate-rise items-center" role="status" aria-live="polite">
      <ThinkingPhoton />
      {/* <ThinkingRobot /> */}
      <span className="sr-only">Waiting for {from ?? "a reply"}</span>
    </div>
  );
}
