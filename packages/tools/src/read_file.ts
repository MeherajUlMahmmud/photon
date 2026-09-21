import fs from "node:fs/promises";
import { z } from "zod";
import type { ToolDefinition } from "@photon/harness";

/** Whole-file reads stop here; the model asks for a slice with offset/limit instead. */
const MAX_LINES = 2000;
const MAX_BYTES = 1024 * 1024;

/**
 * `read_file`: returns a text file with `N\t` line prefixes so the model can
 * quote line numbers back in edits. Mirrors the server's schema
 * (`4_create_default_llm_tools`): `path`, optional 1-based `offset`, `limit`.
 */
export const readFileTool: ToolDefinition<{ path: string; offset?: number; limit?: number }> = {
  name: "read_file",
  description: "Read a text file inside the workspace, with line numbers. Use offset and limit for a slice.",
  risk: "read",
  inputSchema: z.object({
    path: z.string().min(1),
    offset: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).optional(),
  }),
  async execute(input, ctx) {
    // The sandbox rejects anything outside the workspace root (including `..` escapes and symlinks out).
    const abs = ctx.sandbox.resolve(input.path);
    ctx.audit.fileTouched({ path: abs, op: "read" });

    const stat = await fs.stat(abs);
    if (stat.isDirectory()) throw new Error(`${input.path} is a directory; use ls`);
    if (stat.size > MAX_BYTES && !input.limit) {
      throw new Error(`${input.path} is ${stat.size} bytes; read it in slices with offset and limit`);
    }

    const content = await fs.readFile(abs, "utf8");
    // Binary files decode to replacement characters; refuse rather than feed noise to the model.
    if (content.includes("�")) throw new Error(`${input.path} is not a text file`);

    const lines = content.split(/\r?\n/);
    const start = (input.offset ?? 1) - 1;
    const count = Math.min(input.limit ?? MAX_LINES, MAX_LINES);
    const slice = lines.slice(start, start + count);
    const truncated = start + count < lines.length;

    const numbered = slice.map((line, i) => `${start + i + 1}\t${line}`).join("\n");
    return truncated ? `${numbered}\n…[${lines.length - (start + count)} more lines; continue with offset=${start + count + 1}]` : numbered;
  },
};
