import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "@photon/harness";

/**
 * `write_file`: creates or overwrites one text file. Parent folders are
 * created on the way. `risk: "write"` means the desktop asks the user before
 * running it. Mirrors the server's schema: `path`, `content`.
 */
export const writeFileTool: ToolDefinition<{ path: string; content: string }> = {
  name: "write_file",
  description: "Create or overwrite a text file inside the workspace with the given content.",
  risk: "write",
  inputSchema: z.object({
    path: z.string().min(1),
    content: z.string(),
  }),
  async execute(input, ctx) {
    const abs = ctx.sandbox.resolve(input.path);
    // Existence decides the audit op so the UI can say "created" vs "updated".
    const existed = await fs
      .stat(abs)
      .then(() => true)
      .catch(() => false);
    ctx.audit.fileTouched({ path: abs, op: existed ? "update" : "create" });

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, input.content, "utf8");
    const lines = input.content.length ? input.content.split(/\r?\n/).length : 0;
    return `${existed ? "Updated" : "Created"} ${input.path} (${lines} lines, ${Buffer.byteLength(input.content, "utf8")} bytes)`;
  },
};
