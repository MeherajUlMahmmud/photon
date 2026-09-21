import { z } from "zod";

export const ToolRiskSchema = z.enum(["read", "write", "shell", "destructive"]);
export type ToolRisk = z.infer<typeof ToolRiskSchema>;

export const FileOpSchema = z.enum(["read", "create", "update", "delete", "move"]);
export type FileOp = z.infer<typeof FileOpSchema>;

export const ModelRefSchema = z.object({
  provider: z.enum(["anthropic", "openai-compatible"]),
  modelId: z.string().min(1),
  baseUrl: z.string().url().optional(),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  id?: string;
  role: ChatRole;
  content: string;
  toolCallId?: string;
  name?: string;
}

export type ApprovalDecision = "allow" | "deny" | "allow_session";

export interface ApprovalRequest {
  callId: string;
  name: string;
  input: unknown;
  risk: ToolRisk;
}

export type HarnessEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; callId: string; name: string; input: unknown }
  | { type: "approval_needed"; callId: string; name: string; input: unknown; risk: ToolRisk }
  | { type: "tool_result"; callId: string; ok: boolean; summary: string; error?: string }
  | { type: "model_call_finished"; usage: TokenUsage; durationMs: number; ttftMs?: number }
  | { type: "file_touched"; path: string; op: FileOp; fromPath?: string }
  | { type: "error"; message: string; retriable: boolean }
  | { type: "done"; stopReason: string };

export type RunStatus = "ok" | "error" | "cancelled";
