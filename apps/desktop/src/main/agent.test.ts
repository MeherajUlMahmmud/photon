/**
 * Drives `AgentTurn` against a scripted server: each `step/stream/` call
 * answers with the next canned step, and the test checks what the renderer
 * would see (the event list) and what the server would receive (the bodies).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type { AgentEvent, ApprovalDecision } from "../preload/api.js";
import type { ApiClient } from "./api-client.js";
import { AgentTurn } from "./agent.js";

type Line = Record<string, unknown>;

/** A fake ApiClient whose `stream` replays one scripted step per call. */
function scriptedApi(steps: Line[][]) {
  const bodies: unknown[] = [];
  const api = {
    async stream(_path: string, opts: { body: unknown; onLine: (l: Line) => void }) {
      bodies.push(opts.body);
      const lines = steps.shift();
      if (!lines) throw new Error("no more scripted steps");
      for (const line of lines) opts.onLine(line);
    },
  } as unknown as ApiClient;
  return { api, bodies };
}

const done = (extra: Line): Line => ({
  type: "done", provider: "anthropic", model: "m", call_id: "c1", usage: { input_tokens: 1, output_tokens: 2 }, ...extra,
});

describe("AgentTurn", () => {
  let root: string;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "photon-agent-"));
    fs.writeFileSync(path.join(root, "a.txt"), "alpha\n");
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  function run(steps: Line[][], decide?: (turn: AgentTurn, callId: string) => void) {
    const { api, bodies } = scriptedApi(steps);
    const events: AgentEvent[] = [];
    const turn = new AgentTurn({
      api, opts: {}, sessionId: "s1", workspaceRoot: root,
      emit: (e) => {
        events.push(e);
        if (e.type === "approval_needed") decide?.(turn, e.call_id);
      },
    });
    return { turn, events, bodies };
  }

  it("runs read tools without asking and posts results as the next step", async () => {
    const { turn, events, bodies } = run([
      [
        { type: "start", provider: "anthropic", model: "m" },
        { type: "delta", text: "Reading." },
        done({ stop_reason: "tool_use", step_count: 1, pending_tool_calls: [{ call_id: "t1", name: "read_file", input: { path: "a.txt" }, risk: "read" }] }),
      ],
      [{ type: "start", provider: "anthropic", model: "m" }, { type: "delta", text: "It says alpha." }, done({ stop_reason: "end_turn", step_count: 2, pending_tool_calls: [] })],
    ]);
    await turn.run("what is in a.txt?");

    assert.deepEqual(bodies[0], { content: "what is in a.txt?" });
    assert.deepEqual(bodies[1], { tool_results: [{ call_id: "t1", ok: true, output: "1\talpha\n2\t" }] });
    assert.deepEqual(
      events.map((e) => e.type),
      ["start", "delta", "step_done", "tool_call", "tool_running", "tool_result", "start", "delta", "step_done", "done"],
    );
    const result = events.find((e) => e.type === "tool_result");
    assert.equal(result && result.type === "tool_result" && result.ok, true);
    assert.deepEqual(events.at(-1), { type: "done", stop_reason: "end_turn", steps: 2 });
  });

  it("asks before write tools and reports a denial to the server", async () => {
    const { turn, events, bodies } = run(
      [
        [done({ stop_reason: "tool_use", step_count: 1, pending_tool_calls: [{ call_id: "w1", name: "write_file", input: { path: "b.txt", content: "x" }, risk: "write" }] })],
        [done({ stop_reason: "end_turn", step_count: 2, pending_tool_calls: [] })],
      ],
      (t, callId) => t.approve(callId, "deny" satisfies ApprovalDecision),
    );
    await turn.run("write b.txt");

    assert.ok(events.some((e) => e.type === "approval_needed"));
    assert.deepEqual(bodies[1], { tool_results: [{ call_id: "w1", ok: false, error: "denied" }] });
    assert.equal(fs.existsSync(path.join(root, "b.txt")), false);
    const result = events.find((e) => e.type === "tool_result");
    assert.equal(result?.type === "tool_result" && result.denied, true);
  });

  it("allow_session stops asking for that risk level for the rest of the session", async () => {
    let asked = 0;
    const { turn, bodies } = run(
      [
        [done({ stop_reason: "tool_use", step_count: 1, pending_tool_calls: [
          { call_id: "w1", name: "write_file", input: { path: "c.txt", content: "1" }, risk: "write" },
          { call_id: "w2", name: "write_file", input: { path: "d.txt", content: "2" }, risk: "write" },
        ] })],
        [done({ stop_reason: "end_turn", step_count: 2, pending_tool_calls: [] })],
      ],
      (t, callId) => { asked += 1; t.approve(callId, "allow_session"); },
    );
    await turn.run("write two files");
    assert.equal(asked, 1);
    assert.equal(fs.readFileSync(path.join(root, "d.txt"), "utf8"), "2");
    const results = (bodies[1] as { tool_results: Array<{ ok: boolean }> }).tool_results;
    assert.deepEqual(results.map((r) => r.ok), [true, true]);
  });

  it("turns bad model input and sandbox escapes into failed results, not crashes", async () => {
    const { turn, bodies } = run([
      [done({ stop_reason: "tool_use", step_count: 1, pending_tool_calls: [
        { call_id: "x1", name: "read_file", input: {}, risk: "read" },
        { call_id: "x2", name: "read_file", input: { path: "../../etc/passwd" }, risk: "read" },
        { call_id: "x3", name: "nope", input: {}, risk: "destructive" },
      ] })],
      [done({ stop_reason: "end_turn", step_count: 2, pending_tool_calls: [] })],
    ]);
    await turn.run("go");
    const results = (bodies[1] as { tool_results: Array<{ call_id: string; ok: boolean; error: string }> }).tool_results;
    assert.deepEqual(results.map((r) => r.ok), [false, false, false]);
    assert.match(results[0]!.error, /Invalid input for read_file/);
    assert.match(results[1]!.error, /escapes workspace/);
    assert.match(results[2]!.error, /no tool named 'nope'/);
  });

  it("relays a server error and stops", async () => {
    const { turn, events, bodies } = run([[{ type: "error", message: "no provider answered" }]]);
    await turn.run("hi");
    assert.deepEqual(events, [{ type: "error", message: "no provider answered" }]);
    assert.equal(bodies.length, 1);
  });
});
