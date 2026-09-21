import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { PathSandbox } from "@photon/shared";
import { lsTool } from "./ls.js";
import { csTool } from "./cs.js";
import { bashTool } from "./bash.js";
import { readFileTool } from "./read_file.js";
import { writeFileTool } from "./write_file.js";
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

  it("read_file numbers lines and slices", async () => {
    const all = (await readFileTool.execute({ path: "hello.txt" }, ctxFor(root))) as string;
    assert.equal(all, "1\thello photon\n2\t");
    fs.writeFileSync(path.join(root, "many.txt"), Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join("\n"));
    const slice = (await readFileTool.execute({ path: "many.txt", offset: 2, limit: 2 }, ctxFor(root))) as string;
    assert.equal(slice, "2\tline 2\n3\tline 3\n…[2 more lines; continue with offset=4]");
  });

  it("read_file refuses to leave the workspace", async () => {
    await assert.rejects(readFileTool.execute({ path: "../outside.txt" }, ctxFor(root)));
  });

  it("write_file creates parents and reports created vs updated", async () => {
    const first = await writeFileTool.execute({ path: "a/b/new.txt", content: "x\ny" }, ctxFor(root));
    assert.equal(first, "Created a/b/new.txt (2 lines, 3 bytes)");
    assert.equal(fs.readFileSync(path.join(root, "a/b/new.txt"), "utf8"), "x\ny");
    const second = await writeFileTool.execute({ path: "a/b/new.txt", content: "" }, ctxFor(root));
    assert.equal(second, "Updated a/b/new.txt (0 lines, 0 bytes)");
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
