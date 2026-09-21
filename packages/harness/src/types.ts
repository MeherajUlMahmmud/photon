import type { z } from "zod";
import type {
  ApprovalDecision,
  ApprovalRequest,
  FileOp,
  HarnessEvent,
  ToolRisk,
} from "@photon/shared";
import type { PathSandbox } from "@photon/shared";

export interface ToolAudit {
  fileTouched(event: { path: string; op: FileOp; fromPath?: string }): void;
}

export interface ToolContext {
  sandbox: PathSandbox;
  signal: AbortSignal;
  audit: ToolAudit;
  workspaceRoot: string;
}

export interface ToolDefinition<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  risk: ToolRisk;
  execute(input: TInput, ctx: ToolContext): Promise<unknown>;
}

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  schemasForModel(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
}

export type RequestApproval = (req: ApprovalRequest) => Promise<ApprovalDecision>;

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ModelToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ModelStreamEvent {
  type: "text_delta" | "tool_call" | "usage" | "done";
  text?: string;
  toolCall?: ModelToolCall;
  usage?: { inputTokens: number; outputTokens: number };
  stopReason?: string;
}

export interface ModelProvider {
  stream(args: {
    messages: ModelMessage[];
    tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
    systemPrompt?: string;
    signal: AbortSignal;
  }): AsyncIterable<ModelStreamEvent>;
}

export interface HarnessRunOptions {
  messages: ModelMessage[];
  registry: ToolRegistry;
  provider: ModelProvider;
  sandbox: PathSandbox;
  systemPrompt?: string;
  signal: AbortSignal;
  onEvent(event: HarnessEvent): void;
  requestApproval: RequestApproval;
}

export interface HarnessRunResult {
  stopReason: string;
}
