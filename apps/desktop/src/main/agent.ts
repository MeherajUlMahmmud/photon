/**
 * The desktop half of the agent loop.
 *
 * The server owns the transcript and calls the model; this file is the "hands":
 * it streams one model step, runs the tools the model asked for inside the
 * workspace sandbox, posts the results back as the next step, and repeats
 * until the model answers without tools. Everything that happens is relayed to
 * the renderer as `AgentEvent`s so the UI can show each step, each tool call,
 * its input, its output and how long it took.
 *
 * One `AgentTurn` instance = one user message = one or more server steps.
 */
import { PathSandbox } from "@photon/shared";
import type { ToolContext, ToolDefinition } from "@photon/harness";
import { createDefaultToolset } from "@photon/tools";
import type { AgentEvent, ApprovalDecision, ToolRisk } from "../preload/api.js";
import type { ApiClient, RequestOptions } from "./api-client.js";

/** What the server streams for one step (`POST .../step/stream/`). */
type StepEvent =
  | { type: "start"; provider: string; model: string }
  | { type: "delta"; text: string }
  | { type: "tool_call"; call_id: string; name: string; input: Record<string, unknown> }
  | {
      type: "done";
      provider: string;
      model: string;
      call_id: string | null;
      usage: Record<string, number>;
      stop_reason: string;
      step_count: number;
      pending_tool_calls: PendingCall[];
      /** Calls the server refused itself (unknown tool name); already answered in the transcript. */
      rejected_tool_calls: RejectedCall[];
    }
  | { type: "error"; message: string };

type PendingCall = { call_id: string; name: string; input: Record<string, unknown>; risk: ToolRisk };
type RejectedCall = { call_id: string; name: string; input: Record<string, unknown>; error: string };

/** What goes back to the server for each pending call. `error: "denied"` is the server's cue for a refusal. */
type ToolResult = { call_id: string; ok: boolean; output?: string; error?: string };

/** Tools that need a nod from the user before they run. `read` never asks. */
const RISKS_NEEDING_APPROVAL: ReadonlySet<ToolRisk> = new Set(["write", "shell", "destructive"]);

/** A tool's return value is JSON for the model unless it is already text (read_file, write_file). */
function serialize(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === undefined) return "";
  return JSON.stringify(result, null, 2);
}

/**
 * "Allow for this session" answers, per session id and risk level. Lives in
 * main so a renderer reload cannot forget that the user already said yes.
 */
const sessionAllowances = new Map<string, Set<ToolRisk>>();

export type AgentTurnDeps = {
  api: ApiClient;
  /** Token pair plus the refresh hook, exactly as `withTokens` builds it. */
  opts: RequestOptions;
  sessionId: string;
  /** Absolute workspace root, from the server, never from the renderer. */
  workspaceRoot: string;
  emit: (event: AgentEvent) => void;
};

export class AgentTurn {
  private readonly controller = new AbortController();
  /** Tools by name; the server's `LlmToolModel` rows carry the same names. */
  private readonly tools = new Map<string, ToolDefinition>(createDefaultToolset().map((t) => [t.name, t]));
  /** `approval_needed` calls waiting on the user, resolved by `approve()`. */
  private readonly approvals = new Map<string, (decision: ApprovalDecision) => void>();
  private stepsRun = 0;

  constructor(private readonly deps: AgentTurnDeps) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Drives the loop to completion. Resolves once `done` or `error` has been
   * emitted; never rejects for model or tool failures, only for transport
   * errors the caller should surface (those are reported as `error` too).
   */
  async run(content: string): Promise<void> {
    // The first step carries the user's message; every later one carries tool results.
    let body: { content: string } | { tool_results: ToolResult[] } = { content };

    for (;;) {
      if (this.signal.aborted) return this.finish("cancelled");

      const done = await this.step(body);
      if (!done) return; // error or cancel already emitted

      if (done.stop_reason !== "tool_use") return this.finish(done.stop_reason);

      // Calls the server already refused still show up as failed cards, so the
      // user sees what the model tried. Nothing to run for them.
      for (const call of done.rejected_tool_calls ?? []) {
        this.deps.emit({ type: "tool_call", call_id: call.call_id, name: call.name, input: call.input, risk: "destructive" });
        this.deps.emit({ type: "tool_result", call_id: call.call_id, ok: false, output: "", error: call.error, duration_ms: 0, denied: false });
      }

      // Announce every call first so the UI shows the full plan of this step,
      // then run them one by one in the order the model gave. An empty list is
      // still posted: the session is waiting for it before the model may go on.
      for (const call of done.pending_tool_calls) {
        this.deps.emit({ type: "tool_call", call_id: call.call_id, name: call.name, input: call.input, risk: call.risk });
      }
      const results: ToolResult[] = [];
      for (const call of done.pending_tool_calls) {
        if (this.signal.aborted) return this.finish("cancelled");
        results.push(await this.execute(call));
      }
      body = { tool_results: results };
    }
  }

  /** One server step: streams the model, relays text, returns the `done` event (or null after error/cancel). */
  private async step(body: object): Promise<Extract<StepEvent, { type: "done" }> | null> {
    let done: Extract<StepEvent, { type: "done" }> | null = null;
    let failed = false;
    const step = ++this.stepsRun;

    try {
      await this.deps.api.stream<StepEvent>(`/api/ai/agent/session/${this.deps.sessionId}/step/stream/`, {
        ...this.deps.opts,
        body,
        signal: this.signal,
        onLine: (event) => {
          switch (event.type) {
            case "start":
              this.deps.emit({ type: "start", step, provider: event.provider, model: event.model });
              break;
            case "delta":
              this.deps.emit({ type: "delta", text: event.text });
              break;
            case "tool_call":
              // The server also lists these on `done` with their risk; the UI waits for that richer form.
              break;
            case "done":
              done = event;
              this.deps.emit({
                type: "step_done",
                step,
                stop_reason: event.stop_reason,
                call_id: event.call_id,
                usage: event.usage ?? {},
                provider: event.provider,
                model: event.model,
              });
              break;
            case "error":
              failed = true;
              this.deps.emit({ type: "error", message: event.message });
              break;
          }
        },
      });
    } catch (err) {
      if (this.signal.aborted) {
        this.finish("cancelled");
        return null;
      }
      failed = true;
      this.deps.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }

    if (failed) return null;
    if (this.signal.aborted) {
      this.finish("cancelled");
      return null;
    }
    if (!done) {
      // Stream closed without a terminal event: the server keeps the partial text; tell the UI the turn is over.
      this.deps.emit({ type: "error", message: "The server ended the step early." });
      return null;
    }
    return done;
  }

  /** Runs one call end to end: approval (when the risk needs it), execution, result event. */
  private async execute(call: PendingCall): Promise<ToolResult> {
    const started = Date.now();
    const result = (patch: Omit<ToolResult, "call_id">, denied = false): ToolResult => {
      this.deps.emit({
        type: "tool_result",
        call_id: call.call_id,
        ok: patch.ok,
        output: patch.output ?? "",
        error: patch.error ?? "",
        duration_ms: Date.now() - started,
        denied,
      });
      return { call_id: call.call_id, ...patch };
    };

    const tool = this.tools.get(call.name);
    if (!tool) {
      // The server already answers unknown tools itself, so this only happens if the two registries drift.
      return result({ ok: false, error: `This desktop has no tool named '${call.name}'.` });
    }

    if (RISKS_NEEDING_APPROVAL.has(tool.risk) && !this.allowedForSession(tool.risk)) {
      const decision = await this.waitForApproval(call.call_id);
      if (decision === "deny") return result({ ok: false, error: "denied" }, true);
      if (decision === "allow_session") this.allowForSession(tool.risk);
    }
    if (this.signal.aborted) return result({ ok: false, error: "Cancelled by the user" });

    this.deps.emit({ type: "tool_running", call_id: call.call_id });

    // Input comes from the model: validate it against the tool's schema before touching the disk.
    const parsed = tool.inputSchema.safeParse(call.input);
    if (!parsed.success) {
      return result({ ok: false, error: `Invalid input for ${call.name}: ${parsed.error.issues.map((i) => i.message).join("; ")}` });
    }

    const sandbox = new PathSandbox([this.deps.workspaceRoot]);
    const ctx: ToolContext = {
      sandbox,
      workspaceRoot: this.deps.workspaceRoot,
      signal: this.signal,
      audit: { fileTouched: () => undefined },
    };
    try {
      const output = serialize(await tool.execute(parsed.data, ctx));
      return result({ ok: true, output });
    } catch (err) {
      return result({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Registers the resolver *before* asking, so an answer that arrives at once is not lost. */
  private waitForApproval(callId: string): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      this.approvals.set(callId, resolve);
      // A cancel while waiting counts as a denial so the server's pending call still gets an answer.
      this.signal.addEventListener("abort", () => this.approve(callId, "deny"), { once: true });
      this.deps.emit({ type: "approval_needed", call_id: callId });
    });
  }

  /** Called from IPC when the user clicks Allow / Deny / Allow for this session. */
  approve(callId: string, decision: ApprovalDecision): void {
    const resolve = this.approvals.get(callId);
    if (!resolve) return;
    this.approvals.delete(callId);
    resolve(decision);
  }

  private allowedForSession(risk: ToolRisk): boolean {
    return sessionAllowances.get(this.deps.sessionId)?.has(risk) ?? false;
  }

  private allowForSession(risk: ToolRisk): void {
    const set = sessionAllowances.get(this.deps.sessionId) ?? new Set<ToolRisk>();
    set.add(risk);
    sessionAllowances.set(this.deps.sessionId, set);
  }

  /**
   * Stops everything: the model stream (the server keeps whatever text arrived),
   * running tools (their `signal` is this controller's), and pending approvals.
   * The caller also tells the server to drop its pending calls.
   */
  cancel(): void {
    this.controller.abort();
  }

  private finished = false;

  private finish(stopReason: string): void {
    if (this.finished) return;
    this.finished = true;
    this.deps.emit({ type: "done", stop_reason: stopReason, steps: this.stepsRun });
  }
}
