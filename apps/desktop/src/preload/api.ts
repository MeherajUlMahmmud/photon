export type WorkspaceInfo = {
  id: string;
  name: string;
  root_path: string;
  created_at: string;
  last_opened_at: string;
  /** Set when archived: hidden from the sidebar, nothing deleted. Opening the folder again clears it. */
  archived_at: string | null;
};

export type DirEntry = { name: string; kind: "dir" | "file" };

export type FileStat = { size: number; modifiedAt: number };

export type FileContent = {
  /** UTF-8 text; empty when `binary`. Cut at 1 MiB when `truncated`. */
  content: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  modifiedAt: number;
};

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

export type ProviderTestResult = {
  ok: boolean;
  error: string | null;
  /** Model ids the key can use; empty on failure. */
  models: string[];
  latency_ms: number;
  default_model_available?: boolean;
};

/**
 * One transcript line. A user message may name a `skill`: the server splices
 * that skill's instructions in and treats `content` as its arguments.
 */
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  skill?: string;
  /** Inline images for this user message only (companion screenshots). The server passes them to the model and never stores them. */
  images?: ChatImage[];
};

/** A base64 image attached to a user message. */
export type ChatImage = { media_type: "image/png" | "image/jpeg" | "image/webp"; data: string };

/** Whether this app may read the screen. macOS asks once; elsewhere it is always `granted`. */
export type ScreenPermission = "granted" | "denied" | "not-determined" | "restricted" | "unknown";

/** One capture of the display under the pointer, downscaled for the model. */
export type Screenshot = {
  image: ChatImage;
  width: number;
  height: number;
  /** Epoch ms. */
  capturedAt: number;
};

/** A capture attempt: `screenshot` is null when permission is missing or capture failed. */
export type CaptureResult = { screenshot: Screenshot | null; permission: ScreenPermission };

/** Companion preferences, stored per machine by main. */
export type CompanionSettings = {
  /** Off: no global shortcut, overlay hidden, tray keeps only "Open Photon". */
  enabled: boolean;
  /** Electron accelerator, e.g. "Alt+Space" or "Command+Shift+K". */
  shortcut: string;
  /** Take a screenshot each time the shortcut opens the overlay. */
  captureOnOpen: boolean;
  /** Hide the overlay when another app takes focus. */
  hideOnBlur: boolean;
  /** Ctrl + long press of the left mouse button opens the annotate overlay (needs Accessibility on macOS). */
  annotateGesture: boolean;
  /** Keyboard alternative for the annotate overlay. */
  annotateShortcut: string;
};

/** User rebinds for in-app shortcuts, by keymap action id; missing ids use the default. */
export type ShortcutOverrides = Record<string, string>;

/** macOS Accessibility trust, which the global mouse gesture needs. Always `granted` elsewhere. */
export type AccessibilityPermission = "granted" | "denied";

/** The floating companion's setup, for the overlay, Settings and Help. */
export type CompanionInfo = {
  settings: CompanionSettings;
  /** Accelerator actually registered; null when the companion is off or the shortcut is taken. */
  shortcut: string | null;
  permission: ScreenPermission;
  /** Why the last shortcut change or registration failed, if it did. */
  shortcutError: string | null;
  annotate: {
    /** Registered annotate accelerator, or null. */
    shortcut: string | null;
    shortcutError: string | null;
    /** True while the global mouse hook is listening for Ctrl + long press. */
    gestureActive: boolean;
    accessibility: AccessibilityPermission;
  };
};

/** An image handed to the companion from outside (the annotate overlay), with an optional question to send right away. */
export type CompanionAttachment = { image: ChatImage; name: string; note: string };

/** What the overlay has not picked up yet: the last summon's capture and any handed-in images. */
export type CompanionPending = { capture?: CaptureResult; attach?: CompanionAttachment[] };

/** Where the annotate overlay sends its picture. */
export type AnnotationTarget = "companion" | "app";

export type AnnotationSubmit = { image: ChatImage; note: string; target: AnnotationTarget };

/** An annotated screenshot arriving in the main window: opens a new chat with it. */
export type AppAnnotation = { image: ChatImage; note: string };

/**
 * A reusable prompt installed from a pasted Markdown file and invoked as
 * `/<name>` in the composer. `content` is the file body without front matter.
 */
export type Skill = {
  id: string;
  name: string;
  description: string;
  content: string;
  /** Text files that came in the skill's zip; the model reads them with the server-side `read_skill_file` tool. */
  files: SkillFile[];
  created_at: string;
  updated_at: string;
};

export type SkillFile = { path: string; size: number };

/** Install reply: for a zip, `skipped_files` lists entries left out and why ("logo.png (not text)"). */
export type InstalledSkill = Skill & { skipped_files?: string[] };

/** Send exactly one of `markdown` or `archive`. */
export type SkillInstallInput = {
  /** The whole file: optional `---` front matter with `name` / `description`, then the instructions. */
  markdown?: string;
  /** Base64 zip of a skill folder: `SKILL.md` plus references, templates or scripts (stored, never run). */
  archive?: string;
  /** Overrides the name in the file. */
  name?: string;
  /** Update a skill of the same name instead of failing. */
  replace?: boolean;
};

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

/** The client machine, sent when an agent session is created so the model tailors commands to it. */
export type DeviceInfo = {
  /** Node's `process.platform`. */
  os: "darwin" | "linux" | "win32";
  os_version?: string;
  arch?: string;
  shell?: string;
  locale?: string;
  app_version?: string;
};

export type AgentSessionCreateInput = {
  workspace_id?: string | null;
  /** Folder the chat works in; becomes the prompt's root and the tool sandbox root. */
  workspace_path?: string;
  provider?: string;
  model?: string;
  task_key?: string;
};

export type AgentSession = {
  id: string;
  title: string;
  workspace: string | null;
  workspace_path: string;
  provider: string;
  model: string;
  task_key: string;
  device: Partial<DeviceInfo>;
  status: "idle" | "running" | "awaiting_tools" | "error";
  step_count: number;
  max_steps: number;
  last_error: string;
  created_at: string;
  updated_at: string;
};

/** How dangerous a tool call is; anything above `read` needs the user's approval. */
export type ToolRisk = "read" | "write" | "shell" | "destructive";

/** The user's answer to an approval request. `allow_session` stops asking for this risk level in this session. */
export type ApprovalDecision = "allow" | "deny" | "allow_session";

/**
 * One line of an agent turn, as main relays it to the renderer. A turn is
 * several model *steps*; between steps main runs the tools the model asked for.
 *
 *   start → delta* → (tool_call → [approval_needed] → tool_running → tool_result)* → step_done
 *   ...repeat per step... → done | error
 */
export type AgentEvent =
  /** A model step began; `step` counts from 1 within this session. */
  | { type: "start"; step: number; provider: string; model: string }
  /** A chunk of assistant text. */
  | { type: "delta"; text: string }
  /** The model asked for a tool. Emitted for every call before any of them runs. */
  | { type: "tool_call"; call_id: string; name: string; input: Record<string, unknown>; risk: ToolRisk }
  /** Main is waiting for `approveToolCall` before running this call. */
  | { type: "approval_needed"; call_id: string }
  | { type: "tool_running"; call_id: string }
  /** What the tool returned, exactly what is sent back to the model (before the server clips it). */
  | { type: "tool_result"; call_id: string; ok: boolean; output: string; error: string; duration_ms: number; denied: boolean }
  /** The model step finished; `stop_reason` says whether tools follow or the turn is over. */
  | {
      type: "step_done";
      step: number;
      stop_reason: "end_turn" | "tool_use" | "max_steps" | string;
      call_id: string | null;
      usage: Record<string, number>;
      provider: string;
      model: string;
    }
  /** The whole turn is over: the model answered without more tools, hit max_steps, or was cancelled. */
  | { type: "done"; stop_reason: string; steps: number }
  | { type: "error"; message: string };

export type TranscriptionInput = {
  /** Base64 audio, at most a couple of minutes. */
  audio: string;
  mime: string;
  language?: string;
};

export type TranscriptionOutput = { text: string; provider: string; model: string; call_id: string };

/** Where dictation audio is turned into text: on this machine, or through the user's cloud provider. */
export type DictationEngine = "local" | "cloud";

export type LocalDictationStatus = { downloaded: boolean; loaded: boolean };

export type LocalDictationProgress =
  | { stage: "downloading" | "loading"; file: string; percent: number }
  | { stage: "ready" };

/** One line of the streaming completion response. */
export type CompletionEvent =
  | { type: "start"; provider: string; model: string }
  | { type: "delta"; text: string }
  | { type: "done"; provider: string; model: string; call_id: string; usage: Record<string, number> }
  | { type: "error"; message: string };

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
  /** Archives (true) or restores (false) a space. Its chats and files are untouched. */
  setWorkspaceArchived: (tokens: Tokens, workspaceId: string, archived: boolean) => Promise<WithTokens<WorkspaceInfo>>;
  openWorkspace: (tokens: Tokens) => Promise<WithTokens<WorkspaceInfo | null>>;
  /** Save-as dialog for text the renderer produced (chat export). Resolves to the path, or null if cancelled. */
  saveTextFile: (input: { defaultName: string; content: string }) => Promise<string | null>;
  getActiveWorkspace: (tokens: Tokens) => Promise<WithTokens<WorkspaceInfo | null>>;
  /** Lists one directory inside a workspace. `relPath` is relative to the workspace root; "" is the root. */
  listWorkspaceDir: (tokens: Tokens, workspaceId: string, relPath: string) => Promise<WithTokens<DirEntry[]>>;
  /** Size and mtime of one file inside a workspace, without reading it. */
  statWorkspaceFile: (tokens: Tokens, workspaceId: string, relPath: string) => Promise<WithTokens<FileStat>>;
  /** Reads one file inside a workspace for the viewer. */
  readWorkspaceFile: (tokens: Tokens, workspaceId: string, relPath: string) => Promise<WithTokens<FileContent>>;
  /** Opens the file with the OS default application. */
  openWorkspaceFileExternal: (tokens: Tokens, workspaceId: string, relPath: string) => Promise<WithTokens<boolean>>;
  /** Shows the file in Finder / Explorer. */
  revealWorkspaceFile: (tokens: Tokens, workspaceId: string, relPath: string) => Promise<WithTokens<boolean>>;
  updateProfile: (tokens: Tokens, input: { first_name: string; last_name: string }) => Promise<WithTokens<AuthUser>>;
  changePassword: (
    tokens: Tokens,
    input: { old_password: string; new_password: string },
  ) => Promise<WithTokens<Tokens>>;
  listProviders: (tokens: Tokens) => Promise<WithTokens<LlmProvider[]>>;
  /** Checks a key by listing the provider's models. `apiKey` unset tests the stored key. */
  testProvider: (tokens: Tokens, provider: string, apiKey?: string) => Promise<WithTokens<ProviderTestResult>>;
  createCompletion: (tokens: Tokens, input: CompletionInput) => Promise<WithTokens<CompletionOutput>>;
  /** Starts an agent session. Main attaches this machine's `DeviceInfo` so the server shapes the prompt for it. */
  createAgentSession: (tokens: Tokens, input?: AgentSessionCreateInput) => Promise<WithTokens<AgentSession>>;
  /** Re-pins the provider/model an existing session uses from its next step. */
  updateAgentSession: (
    tokens: Tokens,
    sessionId: string,
    input: { provider: string; model: string },
  ) => Promise<WithTokens<AgentSession>>;
  getAgentSession: (tokens: Tokens, sessionId: string) => Promise<WithTokens<AgentSession>>;
  /**
   * Sends one user message and drives the whole tool loop in main: model step,
   * run tools (asking through `approval_needed`), post results, repeat. Events
   * arrive through `onAgentEvent` tagged with `turnId`; the promise settles when
   * the turn ends or is cancelled.
   */
  runAgentTurn: (
    tokens: Tokens,
    turnId: string,
    /** `skill` invokes one of the user's skills; `content` is then its arguments and may be empty. */
    input: { sessionId: string; workspaceId: string; content: string; skill?: string },
  ) => Promise<WithTokens<null>>;
  /** Answers an `approval_needed` event. */
  approveToolCall: (turnId: string, callId: string, decision: ApprovalDecision) => Promise<void>;
  /** Aborts the model stream, kills running tools and tells the server to drop pending calls. */
  cancelAgentTurn: (tokens: Tokens, turnId: string) => Promise<WithTokens<null>>;
  onAgentEvent: (listener: (turnId: string, event: AgentEvent) => void) => () => void;
  /** What `createAgentSession` reports about this machine; for showing in settings. */
  deviceInfo: () => Promise<DeviceInfo>;

  /**
   * Streams a completion. Events arrive through `onCompletionEvent` tagged
   * with `streamId`; the promise settles when the stream ends or is cancelled.
   */
  streamCompletion: (tokens: Tokens, streamId: string, input: CompletionInput) => Promise<WithTokens<null>>;
  cancelCompletion: (streamId: string) => Promise<void>;
  onCompletionEvent: (listener: (streamId: string, event: CompletionEvent) => void) => () => void;
  transcribe: (tokens: Tokens, input: TranscriptionInput) => Promise<WithTokens<TranscriptionOutput>>;
  /** On-device dictation. No tokens: nothing leaves the machine. */
  localDictationStatus: () => Promise<LocalDictationStatus>;
  /** Downloads the speech model if needed and loads it; resolves when ready to transcribe. */
  prepareLocalDictation: () => Promise<LocalDictationStatus>;
  /** `pcm` is mono 16 kHz samples in [-1, 1]. */
  transcribeLocally: (pcm: Float32Array, language?: string) => Promise<{ text: string }>;
  removeLocalDictationModel: () => Promise<boolean>;
  /** Download and load progress for the speech model. Returns an unsubscribe function. */
  onLocalDictationProgress: (listener: (progress: LocalDictationProgress) => void) => () => void;
  listLlmCalls: (tokens: Tokens, query?: LlmCallQuery) => Promise<WithTokens<Page<LlmCall>>>;
  getLlmCall: (tokens: Tokens, id: string) => Promise<WithTokens<LlmCallDetails>>;
  /** Skills, in name order. */
  listSkills: (tokens: Tokens) => Promise<WithTokens<Skill[]>>;
  installSkill: (tokens: Tokens, input: SkillInstallInput) => Promise<WithTokens<InstalledSkill>>;
  /** Replaces the file behind a skill; a different `name` in the file renames it. */
  updateSkill: (tokens: Tokens, name: string, markdown: string) => Promise<WithTokens<Skill>>;
  deleteSkill: (tokens: Tokens, name: string) => Promise<WithTokens<boolean>>;
  /** Companion overlay: settings, active shortcut and screen permission. */
  companionInfo: () => Promise<CompanionInfo>;
  /** Saves a partial change. A shortcut the OS refuses is not saved; `shortcutError` says why. */
  setCompanionSettings: (patch: Partial<CompanionSettings>) => Promise<CompanionInfo>;
  /** Releases the global shortcut while Settings records a new one, so pressing it doesn't open the overlay. */
  suspendCompanionShortcut: (suspended: boolean) => Promise<void>;
  /** Captures the display under the pointer; the overlay hides itself from the shot. */
  captureScreen: () => Promise<CaptureResult>;
  /** Hides the overlay (Esc). */
  hideCompanion: () => Promise<void>;
  /** Shows the overlay from the main window, capturing the screen first. */
  showCompanion: () => Promise<void>;
  /** Brings the main window forward, creating it if it was closed. */
  openMainWindow: () => Promise<void>;
  /** Opens the system screen-recording privacy pane (macOS). */
  openScreenPermissionSettings: () => Promise<void>;
  /** Fired in the overlay when a summon or hand-off is waiting; call `takeCompanionPending` to collect it. */
  onCompanionPending: (listener: () => void) => () => void;
  /** Collects (and clears) the waiting capture and attachments. Also call it on mount: a ping may predate the listener. */
  takeCompanionPending: () => Promise<CompanionPending>;
  /** Opens the annotate overlay now (from Settings or the tray). */
  startAnnotation: () => Promise<void>;
  /** Asks macOS for Accessibility trust (shows the system prompt) and starts the mouse hook once granted. */
  requestAccessibility: () => Promise<CompanionInfo>;
  /** Annotate overlay: fired when a screenshot is waiting; collect it with `takeAnnotationShot` (also on mount). */
  onAnnotateStart: (listener: () => void) => () => void;
  /** The full-resolution screenshot to draw on, once; null when none is waiting. */
  takeAnnotationShot: () => Promise<Screenshot | null>;
  submitAnnotation: (input: AnnotationSubmit) => Promise<void>;
  cancelAnnotation: () => Promise<void>;
  /** In-app shortcut overrides, shared by every window. */
  getShortcuts: () => Promise<ShortcutOverrides>;
  /** Rebinds one action; `accelerator` null resets it, `id` null resets all. Every window hears the change. */
  setShortcut: (id: string | null, accelerator: string | null) => Promise<ShortcutOverrides>;
  onShortcutsChanged: (listener: (overrides: ShortcutOverrides) => void) => () => void;
  /** Main window: fired when an annotated screenshot is waiting; collect it with `takeAppAnnotation` (also on mount). */
  onAppAnnotation: (listener: () => void) => () => void;
  takeAppAnnotation: () => Promise<AppAnnotation | null>;
};
