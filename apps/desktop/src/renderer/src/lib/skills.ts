import type { Skill } from "../../../preload/api";

/** `/name` at the very start of the draft, with `name` still being typed (no space yet). */
const COMMAND_TOKEN = /^\/([a-z0-9_-]*)$/i;
/** `/name` followed by the rest of the message. */
const COMMAND_WITH_ARGS = /^\/([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i;

/**
 * The command token the user is typing, or null when the draft is not (yet)
 * a bare `/name`. Drives the skill menu: it opens for `/`, narrows as letters
 * follow, and closes once a space or newline ends the token.
 */
export function commandQuery(draft: string): string | null {
  const m = COMMAND_TOKEN.exec(draft);
  return m ? m[1]!.toLowerCase() : null;
}

/** Skills whose name or description matches the token, name prefix matches first. */
export function matchSkills(skills: Skill[], query: string): Skill[] {
  const q = query.toLowerCase();
  if (!q) return skills;
  const starts = skills.filter((s) => s.name.startsWith(q));
  const rest = skills.filter((s) => !s.name.startsWith(q) && (s.name.includes(q) || s.description.toLowerCase().includes(q)));
  return [...starts, ...rest];
}

/**
 * Splits a message into the skill it invokes and the arguments after it, when
 * it starts with `/name` and the user has a skill by that name. Anything else
 * (no slash, unknown name) is a plain message.
 */
export function parseInvocation(content: string, skills: Skill[]): { skill?: string; content: string } {
  const m = COMMAND_WITH_ARGS.exec(content.trim());
  if (!m) return { content };
  const name = m[1]!.toLowerCase();
  if (!skills.some((s) => s.name === name)) return { content };
  return { skill: name, content: (m[2] ?? "").trim() };
}

/** How a turn shows what was sent: the command plus its arguments. */
export function invocationLabel(skill: string | undefined, content: string): string {
  return skill ? `/${skill}${content ? ` ${content}` : ""}` : content;
}
