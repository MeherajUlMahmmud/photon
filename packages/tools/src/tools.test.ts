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

  it("cs finds content and reports relative paths", async () => {
    const result = (await csTool.execute({ query: "photon" }, ctxFor(root))) as {
      matchCount: number;
      matches: Array<{ path: string; line: number }>;
    };
    assert.equal(result.matchCount, 1);
    assert.deepEqual(result.matches[0], { path: "hello.txt", line: 1, text: "hello photon" });
  });

  it("cs skips binaries and oversized files, and treats an empty path as the root", async () => {
    fs.writeFileSync(path.join(root, "blob.bin"), Buffer.from([0x70, 0x68, 0x6f, 0x74, 0x6f, 0x6e, 0x00, 0x01]));
    fs.writeFileSync(path.join(root, "huge.txt"), "photon\n".repeat(120_000));
    const result = (await csTool.execute({ query: "photon", path: "" }, ctxFor(root))) as {
      matchCount: number;
      filesSkipped: number;
    };
    assert.equal(result.matchCount, 1);
    assert.equal(result.filesSkipped, 2);
  });

  it("ls filters by glob and walks recursively with relative names", async () => {
    fs.mkdirSync(path.join(root, "pics/inner"), { recursive: true });
    fs.writeFileSync(path.join(root, "pics/a.jpg"), "");
    fs.writeFileSync(path.join(root, "pics/inner/b.JPG"), "");
    fs.writeFileSync(path.join(root, "pics/notes.md"), "");
    const flat = (await lsTool.execute({ path: "pics", glob: "*.jpg" }, ctxFor(root))) as { entries: Array<{ name: string }> };
    assert.deepEqual(flat.entries.map((e) => e.name), ["a.jpg"]);
    const deep = (await lsTool.execute({ path: "pics", glob: "*.jpg", recursive: true }, ctxFor(root))) as {
      count: number;
      entries: Array<{ name: string }>;
    };
    assert.deepEqual(deep.entries.map((e) => e.name), ["a.jpg", "inner/b.JPG"]);
    assert.equal(deep.count, 2);
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
