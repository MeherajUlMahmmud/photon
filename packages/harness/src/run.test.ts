import type { HarnessEvent } from "@photon/shared";
import type { ToolDefinition } from "./types.js";
import { InMemoryToolRegistry } from "./registry.js";
import { run } from "./run.js";
import { createFakeProvider } from "./fake-provider.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { z } from "zod";
import { PathSandbox } from "@photon/shared";


describe("harness.run", () => {
  let root: string;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "photon-harness-"));
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("runs a tool after approval and finishes", async () => {
    const events: HarnessEvent[] = [];
    const registry = new InMemoryToolRegistry();
    const echo: ToolDefinition<{ message: string }> = {
      name: "echo",
      description: "echo",
      risk: "shell",
      inputSchema: z.object({ message: z.string() }),
      execute: async (input) => ({ echoed: input.message }),
    };
    registry.register(echo);

    const result = await run({
      messages: [{ role: "user", content: "hi" }],
      registry,
      provider: createFakeProvider([
        {
          text: "calling echo",
          toolCalls: [{ id: "1", name: "echo", input: { message: "hello" } }],
        },
        { text: "all done", toolCalls: [] },
      ]),
      sandbox: new PathSandbox([root]),
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
      requestApproval: async () => "allow",
    });

    assert.equal(result.stopReason, "end_turn");
    assert.ok(events.some((e) => e.type === "approval_needed"));
    assert.ok(events.some((e) => e.type === "tool_result" && e.ok));
    assert.ok(events.some((e) => e.type === "done"));
  });
});
