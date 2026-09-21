import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "@photon/harness";
import { globMatch } from "./cs.js";

/** A recursive listing stops here so a home folder cannot flood the model. */
const MAX_ENTRIES = 2000;
const SKIP_DIRS = new Set(["node_modules", ".git", ".photon", ".venv", "__pycache__"]);

type Entry = { name: string; type: "dir" | "file" | "symlink"; size?: number };

/**
 * `ls`: entries of one folder, or of the whole tree under it with
 * `recursive`. `glob` keeps only matching names (`*.jpg`), which is the way
 * to answer "which images are here" without reading anything.
 */
export const lsTool: ToolDefinition<{ path?: string; glob?: string; recursive?: boolean }> = {
  name: "ls",
  description: "List files and directories in a workspace path; glob filters by name, recursive walks subfolders.",
  risk: "read",
  inputSchema: z.object({
    path: z.string().default("."),
    glob: z.string().optional(),
    recursive: z.boolean().optional().default(false),
  }),
  async execute(input, ctx) {
    const abs = ctx.sandbox.resolve(input.path?.trim() || ".");
    ctx.audit.fileTouched({ path: abs, op: "read" });
    const items: Entry[] = [];
    let truncated = false;

    async function list(dir: string): Promise<void> {
      if (truncated || ctx.signal.aborted) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (dir === abs) throw err; // the folder the model asked for must exist
        return; // a subfolder we cannot read is skipped, not fatal
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (items.length >= MAX_ENTRIES) {
          truncated = true;
          return;
        }
        const full = path.join(dir, entry.name);
        const type: Entry["type"] = entry.isDirectory() ? "dir" : entry.isSymbolicLink() ? "symlink" : "file";
        const keep = !input.glob || globMatch(entry.name, input.glob);
        if (keep) {
          // Names are relative to the listed folder so nested results stay short and reusable as paths.
          const name = input.recursive ? path.relative(abs, full) : entry.name;
          const size = type === "file" ? await fs.stat(full).then((s) => s.size).catch(() => undefined) : undefined;
          items.push({ name, type, size });
        }
        if (input.recursive && type === "dir" && !SKIP_DIRS.has(entry.name) && ctx.sandbox.isInsideAllowlist(full)) {
          await list(full);
        }
      }
    }

    await list(abs);
    return { path: path.relative(ctx.sandbox.primaryRoot, abs) || ".", count: items.length, truncated, entries: items };
  },
};
