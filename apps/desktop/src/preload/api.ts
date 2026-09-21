export type WorkspaceInfo = {
  id: string;
  name: string;
  root_path: string;
  created_at: string;
  last_opened_at: string;
};

export type DirEntry = { name: string; kind: "dir" | "file" };

export type AuthUser = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  created_at: string;
  last_login: string | null;
};

export type Tokens = { access: string; refresh: string };

export type AuthSession = { user: AuthUser; tokens: Tokens };

export type RegisterInput = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
};

export type AuthResult = ({ ok: true } & AuthSession) | { ok: false; error: string };

export type LlmProvider = {
  id: string;
  provider: string;
  name: string;
  api_style: "anthropic" | "openai_compatible";
  api_url: string;
  default_model: string;
  model_ids: string[];
  priority: number;
  capabilities: string[];
  has_key: boolean;
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type CompletionInput = {
  messages: ChatMessage[];
  provider?: string;
  model?: string;
  task_key?: string;
  temperature?: number;
  max_tokens?: number;
  trace_id?: string;
};

export type CompletionOutput = {
  content: string;
  provider: string;
  model: string;
  call_id: string;
  usage: Record<string, number>;
};

export type LlmCall = {
  id: string;
  provider: string;
  model: string;
  task_key: string;
  trace_id: string | null;
  correlation_id: string;
  status: "success" | "error";
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  cost_usd: string | null;
  error_type: string | null;
  created_at: string;
};

export type LlmCallDetails = LlmCall & {
  prompt_text: string;
  prompt_metadata: Record<string, unknown> | null;
  response_text: string | null;
  response_json: unknown;
  error_message: string | null;
};

export type Page<T> = {
  data: T[];
  total_records: number;
  total_pages: number;
  page_size: number;
  prev_page: string | null;
  next_page: string | null;
};

export type LlmCallQuery = { page?: number; status?: string; provider?: string; task_key?: string };

/**
 * Authenticated calls take the token pair. When the access token has expired,
 * main refreshes it and the result carries `tokens` so the renderer can persist
 * the rotated pair; the old refresh token is dead after that.
 */
export type WithTokens<T> = { data: T; tokens: Tokens | null };

export type PhotonApi = {
  getInfo: () => Promise<{ name: string; version: string }>;
  hasUsers: () => Promise<boolean>;
  register: (input: RegisterInput) => Promise<AuthResult>;
  login: (email: string, password: string) => Promise<AuthResult>;
  logout: (tokens: Tokens) => Promise<boolean>;
  me: (tokens: Tokens) => Promise<WithTokens<AuthUser | null>>;
  getSetting: (tokens: Tokens, key: string) => Promise<WithTokens<string | null>>;
  setSetting: (tokens: Tokens, key: string, value: string) => Promise<WithTokens<boolean>>;
  hasApiKey: (tokens: Tokens, provider: string) => Promise<WithTokens<boolean>>;
  setApiKey: (tokens: Tokens, provider: string, apiKey: string) => Promise<WithTokens<boolean>>;
  deleteApiKey: (tokens: Tokens, provider: string) => Promise<WithTokens<boolean>>;
  listWorkspaces: (tokens: Tokens) => Promise<WithTokens<WorkspaceInfo[]>>;
  openWorkspace: (tokens: Tokens) => Promise<WithTokens<WorkspaceInfo | null>>;
  getActiveWorkspace: (tokens: Tokens) => Promise<WithTokens<WorkspaceInfo | null>>;
  /** Lists one directory inside a workspace. `relPath` is relative to the workspace root; "" is the root. */
  listWorkspaceDir: (tokens: Tokens, workspaceId: string, relPath: string) => Promise<WithTokens<DirEntry[]>>;
  updateProfile: (tokens: Tokens, input: { first_name: string; last_name: string }) => Promise<WithTokens<AuthUser>>;
  changePassword: (
    tokens: Tokens,
    input: { old_password: string; new_password: string },
  ) => Promise<WithTokens<Tokens>>;
  listProviders: (tokens: Tokens) => Promise<WithTokens<LlmProvider[]>>;
  createCompletion: (tokens: Tokens, input: CompletionInput) => Promise<WithTokens<CompletionOutput>>;
  listLlmCalls: (tokens: Tokens, query?: LlmCallQuery) => Promise<WithTokens<Page<LlmCall>>>;
  getLlmCall: (tokens: Tokens, id: string) => Promise<WithTokens<LlmCallDetails>>;
};
