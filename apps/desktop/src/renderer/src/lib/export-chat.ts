import type { Chat, TextTurn, ToolTurn, Turn } from "@/hooks/use-chats";
import { invocationLabel } from "@/lib/skills";

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A fence that cannot be closed early by the content it wraps. */
function fence(text: string, lang = ""): string {
  const longest = text.match(/`{3,}/g)?.reduce((n, run) => Math.max(n, run.length), 0) ?? 0;
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${text.replace(/\n$/, "")}\n${ticks}`;
}

function when(at?: number): string {
  return at ? ` · ${dateFmt.format(at)}` : "";
}

const STATUS_WORDS: Record<ToolTurn["status"], string> = {
  pending: "queued",
  awaiting_approval: "awaiting approval",
  running: "running",
  done: "done",
  failed: "failed",
  denied: "denied by the user",
};

function textTurn(turn: TextTurn): string {
  if (turn.role === "user") return `## You${when(turn.at)}\n\n${invocationLabel(turn.skill, turn.content).trim()}`;
  const bits: string[] = [];
  if (turn.step != null) bits.push(`step ${turn.step}`);
  if (turn.meta?.model) bits.push(turn.meta.model);
  if (turn.meta?.inputTokens != null || turn.meta?.outputTokens != null) {
    bits.push(`${turn.meta.inputTokens ?? "?"} in / ${turn.meta.outputTokens ?? "?"} out`);
  }
  const head = `## Photon${when(turn.at)}` + (bits.length ? `\n\n_${bits.join(" · ")}_` : "");
  const body = turn.content.trim();
  return body ? `${head}\n\n${body}` : head;
}

/**
 * A tool call as a section: what was asked (input JSON), what happened
 * (status, timing), and what came back verbatim. Denials and errors are kept
 * so the export reads like the transcript did.
 */
function toolTurn(turn: ToolTurn): string {
  const meta = [`step ${turn.step}`, `risk: ${turn.risk}`, STATUS_WORDS[turn.status]];
  if (turn.durationMs != null) meta.push(`${turn.durationMs} ms`);
  const parts = [
    `### Tool: \`${turn.name}\`${when(turn.at)}`,
    `_${meta.join(" · ")}_`,
    `**Input**`,
    fence(JSON.stringify(turn.input, null, 2), "json"),
  ];
  if (turn.output) parts.push(`**Output**`, fence(turn.output));
  if (turn.error && turn.status !== "denied") parts.push(`**Error**`, fence(turn.error));
  return parts.join("\n\n");
}

/**
 * The whole conversation as Markdown: a header with the chat's facts, then
 * every turn in order, tool calls included, exactly as the transcript shows them.
 */
export function chatToMarkdown(chat: Chat, opts: { space?: string; exportedBy?: string } = {}): string {
  const facts: string[] = [
    `- Model: \`${chat.provider}\` / \`${chat.model}\``,
    `- Started: ${dateFmt.format(chat.createdAt)}`,
    `- Last message: ${dateFmt.format(chat.updatedAt)}`,
  ];
  if (opts.space) facts.push(`- Space: ${opts.space}`);
  if (chat.sessionId) facts.push(`- Agent session: \`${chat.sessionId}\``);
  if (opts.exportedBy) facts.push(`- Exported by: ${opts.exportedBy}`);

  const turns = chat.turns.map((t: Turn) => (t.role === "tool" ? toolTurn(t) : textTurn(t)));
  return [`# ${chat.title}`, facts.join("\n"), ...turns].join("\n\n") + "\n";
}

/** A safe filename from the chat title: letters, digits, dashes; never empty. */
export function exportFilename(chat: Chat): string {
  const slug = chat.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "chat"}.md`;
}
