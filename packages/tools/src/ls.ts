import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "@photon/harness";

export const lsTool: ToolDefinition<{ path?: string }> = {
  name: "ls",
  description: "List files and directories in a workspace path",
  risk: "read",
  inputSchema: z.object({
    path: z.string().default("."),
  }),
  async execute(input, ctx) {
    const abs = ctx.sandbox.resolve(input.path ?? ".");
    ctx.audit.fileTouched({ path: abs, op: "read" });
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(abs, entry.name);
        let size: number | undefined;
        try {
          const stat = await fs.stat(full);
          size = stat.size;
        } catch {
          size = undefined;
        }
        return {
          name: entry.name,
          type: entry.isDirectory() ? "dir" : entry.isSymbolicLink() ? "symlink" : "file",
          size,
        };
      }),
    );
    items.sort((a, b) => a.name.localeCompare(b.name));
    return { path: abs, entries: items };
  },
};
