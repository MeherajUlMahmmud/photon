import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "@photon/harness";

const DEFAULT_MAX_MATCHES = 100;
/** Files above this are skipped: they are archives, media or generated bundles, not code. */
const MAX_FILE_BYTES = 512 * 1024;
/** Bytes sniffed for a NUL to tell binary from text before reading a file whole. */
const SNIFF_BYTES = 8 * 1024;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".photon", ".venv", "__pycache__", ".next", "build"]);

/**
 * `cs`: substring search over file *contents*. Matches file names only when
 * `glob` narrows them; to find files by name use `ls` with `glob` instead.
 * Skips binaries, big files and dependency folders so a search over a home
 * folder full of videos comes back in a moment rather than reading them all.
 */
export const csTool: ToolDefinition<{
  query: string;
  path?: string;
  glob?: string;
  caseSensitive?: boolean;
}> = {
  name: "cs",
  description: "Substring search over text file contents within the workspace. For file names, use ls with glob.",
  risk: "read",
  inputSchema: z.object({
    query: z.string().min(1),
    path: z.string().optional(),
    glob: z.string().optional(),
    caseSensitive: z.boolean().optional().default(false),
  }),
  async execute(input, ctx) {
    // Models sometimes send "" for "the root"; treat it like an absent path.
    const root = ctx.sandbox.resolve(input.path?.trim() || ".");
    ctx.audit.fileTouched({ path: root, op: "read" });
    const matches: Array<{ path: string; line: number; text: string }> = [];
    const needle = input.caseSensitive ? input.query : input.query.toLowerCase();
    let filesScanned = 0;
    let filesSkipped = 0;

    async function walk(dir: string): Promise<void> {
      if (matches.length >= DEFAULT_MAX_MATCHES || ctx.signal.aborted) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // unreadable folder: skip, do not fail the whole search
      }
      for (const entry of entries) {
        if (matches.length >= DEFAULT_MAX_MATCHES || ctx.signal.aborted) break;
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (!ctx.sandbox.isInsideAllowlist(full)) continue;
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (input.glob && !globMatch(entry.name, input.glob)) continue;

        const content = await readText(full);
        if (content === null) {
          filesSkipped += 1;
          continue;
        }
        filesScanned += 1;
        const lines = content.split(/\r?\n/);
        for (let idx = 0; idx < lines.length && matches.length < DEFAULT_MAX_MATCHES; idx += 1) {
          const line = lines[idx]!;
          const hay = input.caseSensitive ? line : line.toLowerCase();
          if (hay.includes(needle)) {
            // Relative to the canonical root (symlinks resolved), what the model passes back to read_file, and shorter for it to read.
            matches.push({ path: path.relative(ctx.sandbox.primaryRoot, full), line: idx + 1, text: line.slice(0, 300) });
          }
        }
      }
    }

    await walk(root);
    return {
      query: input.query,
      matchCount: matches.length,
      truncated: matches.length >= DEFAULT_MAX_MATCHES,
      filesScanned,
      filesSkipped,
      matches,
    };
  },
};

/** File contents as text, or null when the file is too big or binary. */
async function readText(file: string): Promise<string | null> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(file, "r");
    const { size } = await handle.stat();
    if (size > MAX_FILE_BYTES) return null;
    const sniff = Buffer.alloc(Math.min(SNIFF_BYTES, size));
    const { bytesRead } = await handle.read(sniff, 0, sniff.length, 0);
    if (sniff.subarray(0, bytesRead).includes(0)) return null;
    return (await handle.readFile()).toString("utf8");
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/** Minimal `*` and `?` glob against the basename only. */
export function globMatch(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(name);
}
