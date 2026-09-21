import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { PathSandbox } from "@photon/shared";
import { lsTool } from "./ls.js";
import { csTool } from "./cs.js";
import { bashTool } from "./bash.js";
import type { ToolContext } from "@photon/harness";

function ctxFor(root: string): ToolContext {
  const sandbox = new PathSandbox([root]);
  return {
    sandbox,
    workspaceRoot: root,
    signal: new AbortController().signal,
    audit: { fileTouched: () => undefined },
  };
}

describe("tools", () => {
  let root: string;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "photon-tools-"));
    fs.writeFileSync(path.join(root, "hello.txt"), "hello photon\n");
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("ls lists entries", async () => {
    const result = (await lsTool.execute({ path: "." }, ctxFor(root))) as {
      entries: Array<{ name: string }>;
    };
    assert.ok(result.entries.some((e) => e.name === "hello.txt"));
  });

  it("cs finds content", async () => {
    const result = (await csTool.execute({ query: "photon" }, ctxFor(root))) as {
      matchCount: number;
    };
    assert.equal(result.matchCount, 1);
  });

  it("bash runs in workspace cwd", async () => {
    const result = (await bashTool.execute({ command: "pwd" }, ctxFor(root))) as {
      exitCode: number;
      stdout: string;
    };
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes(path.basename(root)) || fs.realpathSync(root) === result.stdout.trim());
  });
});
