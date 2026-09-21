import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { PathSandbox, PathSandboxError } from "./sandbox.js";

describe("PathSandbox", () => {
  let root: string;
  let outside: string;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "photon-ws-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "photon-out-"));
    fs.writeFileSync(path.join(root, "a.txt"), "hi");
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("resolves paths inside the workspace", () => {
    const sandbox = new PathSandbox([root]);
    const resolved = sandbox.resolve("a.txt");
    assert.equal(resolved, path.join(fs.realpathSync(root), "a.txt"));
  });

  it("rejects paths outside the workspace", () => {
    const sandbox = new PathSandbox([root]);
    assert.throws(() => sandbox.resolve(path.join(outside, "x.txt")), PathSandboxError);
  });

  it("rejects .. escape", () => {
    const sandbox = new PathSandbox([root]);
    assert.throws(() => sandbox.resolve("../nope"), PathSandboxError);
  });
});
