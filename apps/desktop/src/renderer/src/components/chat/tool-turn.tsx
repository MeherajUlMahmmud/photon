import * as React from "react";
import {
  CaretRight,
  Check,
  CircleNotch,
  FileText,
  FolderOpen,
  MagnifyingGlass,
  PencilSimple,
  Prohibit,
  Terminal,
  Warning,
  Wrench,
} from "@phosphor-icons/react";

import type { ApprovalDecision } from "../../../../preload/api";
import type { ToolStatus, ToolTurn } from "@/hooks/use-chats";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Icon per tool name; anything the desktop does not know gets a wrench. */
const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string; weight?: "bold" }>> = {
  ls: FolderOpen,
  cs: MagnifyingGlass,
  read_file: FileText,
  write_file: PencilSimple,
  bash: Terminal,
};

/** Plain-English label for each tool, used in the card header. */
const TOOL_LABELS: Record<string, string> = {
  ls: "List folder",
  cs: "Search code",
  read_file: "Read file",
  write_file: "Write file",
  bash: "Run command",
};

/**
 * The one input field worth showing in the header without expanding: the path
 * for file tools, the query for search, the command for bash.
 */
function headline(turn: ToolTurn): string {
  const i = turn.input;
  const pick = (key: string) => (typeof i[key] === "string" ? (i[key] as string) : "");
  switch (turn.name) {
    case "bash":
      return pick("command");
    case "cs":
      return pick("query");
    default:
      return pick("path") || ".";
  }
}

const STATUS_LABELS: Record<ToolStatus, string> = {
  pending: "Queued",
  awaiting_approval: "Needs your OK",
  running: "Running",
  done: "Done",
  failed: "Failed",
  denied: "Denied",
};

function StatusBadge({ status }: { status: ToolStatus }) {
  switch (status) {
    case "done":
      return (
        <Badge variant="granted">
          <Check weight="bold" /> {STATUS_LABELS.done}
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="failed">
          <Warning weight="bold" /> {STATUS_LABELS.failed}
        </Badge>
      );
    case "denied":
      return (
        <Badge variant="outline">
          <Prohibit weight="bold" /> {STATUS_LABELS.denied}
        </Badge>
      );
    case "running":
      return (
        <Badge variant="muted">
          <CircleNotch weight="bold" className="animate-spin" /> {STATUS_LABELS.running}
        </Badge>
      );
    case "awaiting_approval":
      return <Badge variant="failed">{STATUS_LABELS.awaiting_approval}</Badge>;
    default:
      return <Badge variant="muted">{STATUS_LABELS.pending}</Badge>;
  }
}

function duration(ms?: number): string {
  if (ms == null) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Long tool output is shown in a scroll box; the model got the full text regardless. */
function OutputBlock({ label, text, tone = "plain" }: { label: string; text: string; tone?: "plain" | "problem" }) {
  return (
    <div className="mt-3">
      <p className="mb-1 font-mono text-micro text-slate">{label}</p>
      <pre
        className={`max-h-72 overflow-auto rounded-md border px-3 py-2 font-mono text-small whitespace-pre-wrap ${
          tone === "problem" ? "border-black bg-sheet" : "border-input bg-sheet"
        }`}
      >
        {text}
      </pre>
    </div>
  );
}

/** What the user is agreeing to, worded per risk level. */
function approvalCopy(turn: ToolTurn): string {
  switch (turn.risk) {
    case "shell":
      return "This runs a command on your machine inside the workspace folder.";
    case "write":
      return "This changes a file inside the workspace folder.";
    default:
      return "This can change or remove things on your machine.";
  }
}

/**
 * One tool call in a workspace chat: header row (tool, target, status,
 * timing) that expands to the full input, the output the model received and
 * the error, if any. Cards that need a decision or went wrong start expanded;
 * routine reads start collapsed to keep the transcript readable.
 */
export function ToolTurnCard({
  turn,
  onDecide,
}: {
  turn: ToolTurn;
  /** Present only while the turn is in flight; absent cards cannot be approved (e.g. after a reload). */
  onDecide?: (callId: string, decision: ApprovalDecision) => void;
}) {
  const attention = turn.status === "awaiting_approval" || turn.status === "failed";
  const [open, setOpen] = React.useState(attention);
  // A card that later needs attention pops open on its own; the user can still fold it.
  React.useEffect(() => {
    if (attention) setOpen(true);
  }, [attention]);

  const Icon = TOOL_ICONS[turn.name] ?? Wrench;
  const label = TOOL_LABELS[turn.name] ?? turn.name;
  const target = headline(turn);

  return (
    <div className="mr-auto w-full max-w-[75%] pl-11">
      <div className="rounded-lg border border-input" aria-busy={turn.status === "running" || undefined}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
        >
          <CaretRight weight="bold" className={`size-3 shrink-0 text-slate transition-transform ${open ? "rotate-90" : ""}`} />
          <Icon weight="bold" className="size-4 shrink-0 text-slate" />
          <span className="shrink-0 text-small font-medium">{label}</span>
          {target && <span className="min-w-0 flex-1 truncate font-mono text-small text-slate">{target}</span>}
          {!target && <span className="flex-1" />}
          {turn.durationMs != null && <span className="font-mono text-micro text-slate">{duration(turn.durationMs)}</span>}
          <StatusBadge status={turn.status} />
        </button>

        {open && (
          <div className="border-t border-input px-3 py-3">
            <p className="font-mono text-micro text-slate">
              step {turn.step} · {turn.name} · {turn.risk}
            </p>
            <OutputBlock label="Input" text={JSON.stringify(turn.input, null, 2)} />

            {turn.status === "awaiting_approval" && (
              <div className="mt-3 rounded-md bg-muted px-3 py-3">
                <p className="text-small">{approvalCopy(turn)}</p>
                {onDecide ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="granted" onClick={() => onDecide(turn.callId, "allow")}>
                      Allow
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onDecide(turn.callId, "allow_session")}>
                      Allow {turn.risk} for this chat
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDecide(turn.callId, "deny")}>
                      Deny
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-small text-slate">This request is no longer active.</p>
                )}
              </div>
            )}

            {turn.output && <OutputBlock label="Output" text={turn.output} />}
            {turn.error && turn.status !== "denied" && <OutputBlock label="Error" text={turn.error} tone="problem" />}
            {turn.status === "denied" && (
              <p className="mt-3 text-small text-slate">You denied this call; the model was told and moved on.</p>
            )}
            {turn.status === "running" && !turn.output && (
              <p className="mt-3 text-small text-slate">Running on your machine…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
