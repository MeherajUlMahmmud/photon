import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "@photon/harness";

const DEFAULT_MAX_MATCHES = 100;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".photon"]);

export const csTool: ToolDefinition<{
  query: string;
  path?: string;
  glob?: string;
  caseSensitive?: boolean;
}> = {
  name: "cs",
  description: "Code/content search (substring) within the workspace allowlist",
  risk: "read",
  inputSchema: z.object({
    query: z.string().min(1),
    path: z.string().optional(),
    glob: z.string().optional(),
    caseSensitive: z.boolean().optional().default(false),
  }),
  async execute(input, ctx) {
    const root = ctx.sandbox.resolve(input.path ?? ".");
    ctx.audit.fileTouched({ path: root, op: "read" });
    const matches: Array<{ path: string; line: number; text: string }> = [];
    const needle = input.caseSensitive ? input.query : input.query.toLowerCase();

    async function walk(dir: string): Promise<void> {
      if (matches.length >= DEFAULT_MAX_MATCHES) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (matches.length >= DEFAULT_MAX_MATCHES) break;
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (!ctx.sandbox.isInsideAllowlist(full)) continue;
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (input.glob && !globMatch(entry.name, input.glob)) continue;
        try {
          const content = await fs.readFile(full, "utf8");
          const lines = content.split(/\r?\n/);
          lines.forEach((line, idx) => {
            if (matches.length >= DEFAULT_MAX_MATCHES) return;
            const hay = input.caseSensitive ? line : line.toLowerCase();
            if (hay.includes(needle)) {
              matches.push({
                path: full,
                line: idx + 1,
                text: line.slice(0, 300),
              });
            }
          });
        } catch {
          // skip binary / unreadable
        }
      }
    }

    await walk(root);
    return { query: input.query, matchCount: matches.length, matches };
  },
};

function globMatch(name: string, pattern: string): boolean {
  // Minimal * and ? glob against basename only
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(name);
}
