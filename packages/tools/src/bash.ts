import { spawn } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition } from "@photon/harness";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 256 * 1024;

export const bashTool: ToolDefinition<{ command: string; cwd?: string }> = {
  name: "bash",
  description:
    "Run a shell command inside the workspace. cwd must be inside an allowlisted root. Requires approval.",
  risk: "shell",
  inputSchema: z.object({
    command: z.string().min(1),
    cwd: z.string().optional(),
  }),
  async execute(input, ctx) {
    const command = input.command.replace(/\0/g, "").trim();
    if (!command) {
      throw new Error("Empty command");
    }

    const cwd = ctx.sandbox.resolve(input.cwd ?? ".");
    ctx.audit.fileTouched({ path: cwd, op: "read" });

    return await runCommand(command, cwd, ctx.signal);
  },
};

function runCommand(
  command: string,
  cwd: string,
  signal: AbortSignal,
): Promise<{
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
        HOME: process.env.HOME,
        LANG: process.env.LANG ?? "en_US.UTF-8",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let truncated = false;

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      const current = target === "stdout" ? stdout : stderr;
      if (current.length >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      const next = Buffer.concat([current, chunk]);
      if (next.length > MAX_OUTPUT_BYTES) {
        truncated = true;
        const sliced = next.subarray(0, MAX_OUTPUT_BYTES);
        if (target === "stdout") stdout = sliced;
        else stderr = sliced;
      } else if (target === "stdout") {
        stdout = next;
      } else {
        stderr = next;
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`bash timed out after ${DEFAULT_TIMEOUT_MS}ms`));
    }, DEFAULT_TIMEOUT_MS);

    const onAbort = () => {
      child.kill("SIGKILL");
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve({
        command,
        cwd,
        exitCode,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        truncated,
        durationMs: Date.now() - started,
      });
    });
  });
}
