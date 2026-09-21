import type { ModelProvider, ModelStreamEvent, ModelToolCall } from "./types.js";

/** Deterministic provider for harness unit tests — no network. */
export function createFakeProvider(script: FakeTurn[]): ModelProvider {
  let index = 0;
  return {
    async *stream(): AsyncIterable<ModelStreamEvent> {
      const turn = script[index++] ?? { text: "done", toolCalls: [] };
      if (turn.text) {
        yield { type: "text_delta", text: turn.text };
      }
      for (const toolCall of turn.toolCalls ?? []) {
        yield { type: "tool_call", toolCall };
      }
      yield {
        type: "usage",
        usage: { inputTokens: turn.inputTokens ?? 10, outputTokens: turn.outputTokens ?? 5 },
      };
      yield { type: "done", stopReason: turn.stopReason ?? "end_turn" };
    },
  };
}

export interface FakeTurn {
  text?: string;
  toolCalls?: ModelToolCall[];
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string;
}
