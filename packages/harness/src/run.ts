import type { HarnessEvent, TokenUsage } from "@photon/shared";
import type { HarnessRunOptions, HarnessRunResult, ModelToolCall } from "./types.js";

const DEFAULT_SYSTEM = `You are Photon, a local desktop teammate.
Prefer ls and cs for discovery. Use bash for actions inside the workspace only.
Stay inside the workspace allowlist. Keep commands small and reversible.`;

/**
 * Greenfield agent loop: model → tool calls → approvals → results → repeat.
 */
export async function run(options: HarnessRunOptions): Promise<HarnessRunResult> {
  const {
    registry,
    provider,
    sandbox,
    signal,
    onEvent,
    requestApproval,
    systemPrompt = DEFAULT_SYSTEM,
  } = options;

  const messages = [...options.messages];
  let stopReason = "completed";
  let turn = 0;
  const maxTurns = 32;

  try {
    while (turn < maxTurns) {
      if (signal.aborted) {
        stopReason = "cancelled";
        break;
      }
      turn += 1;

      const toolCalls: ModelToolCall[] = [];
      let assistantText = "";
      let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
      const callStarted = Date.now();
      let ttftMs: number | undefined;

      for await (const event of provider.stream({
        messages,
        tools: registry.schemasForModel(),
        systemPrompt,
        signal,
      })) {
        if (signal.aborted) {
          stopReason = "cancelled";
          break;
        }
        if (event.type === "text_delta" && event.text) {
          if (ttftMs === undefined) ttftMs = Date.now() - callStarted;
          assistantText += event.text;
          onEvent({ type: "text_delta", text: event.text });
        } else if (event.type === "tool_call" && event.toolCall) {
          toolCalls.push(event.toolCall);
        } else if (event.type === "usage" && event.usage) {
          usage = {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            totalTokens: event.usage.inputTokens + event.usage.outputTokens,
          };
        } else if (event.type === "done") {
          stopReason = event.stopReason ?? stopReason;
        }
      }

      onEvent({
        type: "model_call_finished",
        usage,
        durationMs: Date.now() - callStarted,
        ttftMs,
      });

      if (assistantText) {
        messages.push({ role: "assistant", content: assistantText });
      }

      if (toolCalls.length === 0) {
        break;
      }

      for (const call of toolCalls) {
        if (signal.aborted) {
          stopReason = "cancelled";
          break;
        }

        const tool = registry.get(call.name);
        onEvent({
          type: "tool_start",
          callId: call.id,
          name: call.name,
          input: call.input,
        });

        if (!tool) {
          const summary = `Unknown tool: ${call.name}`;
          onEvent({ type: "tool_result", callId: call.id, ok: false, summary, error: summary });
          messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: summary,
          });
          continue;
        }

        const parsed = tool.inputSchema.safeParse(call.input);
        if (!parsed.success) {
          const summary = `Invalid input: ${parsed.error.message}`;
          onEvent({ type: "tool_result", callId: call.id, ok: false, summary, error: summary });
          messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: summary,
          });
          continue;
        }

        if (tool.risk === "shell" || tool.risk === "destructive" || tool.risk === "write") {
          onEvent({
            type: "approval_needed",
            callId: call.id,
            name: call.name,
            input: parsed.data,
            risk: tool.risk,
          });
          const decision = await requestApproval({
            callId: call.id,
            name: call.name,
            input: parsed.data,
            risk: tool.risk,
          });
          if (decision === "deny") {
            const summary = "User denied tool execution";
            onEvent({ type: "tool_result", callId: call.id, ok: false, summary, error: summary });
            messages.push({
              role: "tool",
              toolCallId: call.id,
              name: call.name,
              content: summary,
            });
            continue;
          }
        }

        try {
          const result = await tool.execute(parsed.data, {
            sandbox,
            signal,
            workspaceRoot: sandbox.primaryRoot,
            audit: {
              fileTouched: (event) => onEvent({ type: "file_touched", ...event }),
            },
          });
          const summary = summarizeResult(result);
          onEvent({ type: "tool_result", callId: call.id, ok: true, summary });
          messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: typeof result === "string" ? result : JSON.stringify(result),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          onEvent({
            type: "tool_result",
            callId: call.id,
            ok: false,
            summary: message,
            error: message,
          });
          messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: message,
          });
        }
      }
    }

    if (turn >= maxTurns) {
      stopReason = "max_turns";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onEvent({ type: "error", message, retriable: false });
    stopReason = "error";
  }

  onEvent({ type: "done", stopReason });
  return { stopReason };
}

function summarizeResult(result: unknown): string {
  if (typeof result === "string") {
    return result.length > 500 ? `${result.slice(0, 500)}…` : result;
  }
  try {
    const json = JSON.stringify(result);
    return json.length > 500 ? `${json.slice(0, 500)}…` : json;
  } catch {
    return String(result);
  }
}

export type { HarnessEvent };
