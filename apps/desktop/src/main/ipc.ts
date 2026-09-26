import type { BrowserWindow, Dialog } from "electron";
import { ipcMain, shell } from "electron";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type {
  AgentSession,
  AgentSessionCreateInput,
  ApprovalDecision,
  AuthResult,
  AuthSession,
  AuthUser,
  CompletionEvent,
  CompletionInput,
  CompletionOutput,
  DirEntry,
  FileContent,
  FileStat,
  InstalledSkill,
  LlmCall,
  LlmCallDetails,
  LlmCallQuery,
  LlmProvider,
  ProviderTestResult,
  Page,
  RegisterInput,
  Skill,
  SkillInstallInput,
  Tokens,
  TranscriptionInput,
  TranscriptionOutput,
  WithTokens,
  WorkspaceInfo,
} from "../preload/api.js";
import { ApiError, type ApiClient } from "./api-client.js";
import { AgentTurn } from "./agent.js";
import { deviceInfo } from "./device-info.js";

export interface IpcDeps {
  api: ApiClient;
  getWindow: () => BrowserWindow | null;
  dialog: Dialog;
}

type Paginated<T> = Page<T>;

/** Files above this size are cut off in the viewer; the agent should not be reading them whole anyway. */
const FILE_VIEW_LIMIT = 1024 * 1024;

/**
 * Workspace roots seen so far, by id. The `photon-file://` protocol serves
 * images and PDFs by streaming from disk, and it has no tokens to ask the
 * server, so it resolves paths against this cache instead.
 */
const workspaceRoots = new Map<string, string>();

/** Resolves `relPath` under `root`, or null when it would escape it. */
function containedPath(root: string, relPath: string): string | null {
  const base = resolve(root);
  const target = resolve(base, relPath || ".");
  const rel = relative(base, target);
  if (rel.startsWith("..") || rel.startsWith(sep) || resolve(base, rel) !== target) return null;
  return target;
}

/** Absolute path of a file in a workspace the renderer has already listed, or null. */
export function cachedWorkspacePath(workspaceId: string, relPath: string): string | null {
  const root = workspaceRoots.get(workspaceId);
  return root ? containedPath(root, relPath) : null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerIpc(deps: IpcDeps): void {
  const { api, getWindow, dialog } = deps;

  /** Runs an authenticated call, reporting a refreshed token pair back to the renderer. */
  async function withTokens<T>(
    tokens: Tokens,
    call: (opts: { tokens: Tokens; onTokensRefreshed: (t: Tokens) => void }) => Promise<T>,
  ): Promise<WithTokens<T>> {
    let refreshed: Tokens | null = null;
    const data = await call({ tokens, onTokensRefreshed: (t) => (refreshed = t) });
    return { data, tokens: refreshed };
  }

  async function authCall(path: string, body: Record<string, string>): Promise<AuthResult> {
    try {
      const session = await api.request<AuthSession>("POST", path, { body });
      return { ok: true, ...session };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
  }

  ipcMain.handle("app:getInfo", () => ({
    name: "Photon",
    version: "0.1.0",
  }));

  ipcMain.handle("auth:hasUsers", async () => {
    const { has_users } = await api.request<{ has_users: boolean }>("GET", "/api/auth/has-users/");
    return has_users;
  });

  ipcMain.handle("auth:register", (_e, input: RegisterInput) =>
    authCall("/api/auth/register/", {
      email: input.email,
      password: input.password,
      first_name: input.first_name.trim(),
      last_name: input.last_name.trim(),
    }),
  );

  ipcMain.handle("auth:login", (_e, email: string, password: string) =>
    authCall("/api/auth/login/", { email, password }),
  );

  ipcMain.handle("auth:logout", async (_e, tokens: Tokens) => {
    try {
      await api.request("POST", "/api/auth/logout/", {
        tokens,
        body: { refresh_token: tokens.refresh },
      });
    } catch {
      // Signing out locally should still succeed if the server is unreachable.
    }
    return true;
  });

  ipcMain.handle("auth:me", (_e, tokens: Tokens) =>
    withTokens(tokens, async (opts) => {
      try {
        return await api.request<AuthUser>("GET", "/api/user/me/", opts);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    }),
  );

  ipcMain.handle("settings:get", (_e, tokens: Tokens, key: string) =>
    withTokens(tokens, async (opts) => {
      const { value } = await api.request<{ value: string | null }>(
        "GET",
        `/api/setting/${encodeURIComponent(key)}/details/`,
        opts,
      );
      return value;
    }),
  );

  ipcMain.handle("settings:set", (_e, tokens: Tokens, key: string, value: string) =>
    withTokens(tokens, async (opts) => {
      await api.request("PUT", `/api/setting/${encodeURIComponent(key)}/update/`, {
        ...opts,
        body: { value },
      });
      return true;
    }),
  );

  ipcMain.handle("secrets:hasApiKey", (_e, tokens: Tokens, provider: string) =>
    withTokens(tokens, async (opts) => {
      const { has_key } = await api.request<{ has_key: boolean }>(
        "GET",
        `/api/secret/${encodeURIComponent(provider)}/details/`,
        opts,
      );
      return has_key;
    }),
  );

  ipcMain.handle("secrets:setApiKey", (_e, tokens: Tokens, provider: string, apiKey: string) =>
    withTokens(tokens, async (opts) => {
      await api.request("PUT", `/api/secret/${encodeURIComponent(provider)}/update/`, {
        ...opts,
        body: { api_key: apiKey },
      });
      return true;
    }),
  );

  ipcMain.handle("secrets:deleteApiKey", (_e, tokens: Tokens, provider: string) =>
    withTokens(tokens, async (opts) => {
      await api.request("DELETE", `/api/secret/${encodeURIComponent(provider)}/delete/`, opts);
      return true;
    }),
  );

  ipcMain.handle("workspace:list", (_e, tokens: Tokens) =>
    withTokens(tokens, async (opts) => {
      const page = await api.request<Paginated<WorkspaceInfo>>("GET", "/api/workspace/list/", opts);
      return page.data;
    }),
  );

  ipcMain.handle("workspace:setArchived", (_e, tokens: Tokens, workspaceId: string, archived: boolean) =>
    withTokens(tokens, (opts) =>
      api.request<WorkspaceInfo>(
        "POST",
        `/api/workspace/${encodeURIComponent(workspaceId)}/${archived ? "archive" : "unarchive"}/`,
        opts,
      ),
    ),
  );

  /** Asks where to save a text file the renderer built (chat export). Returns the path, or null on cancel. */
  ipcMain.handle("file:saveText", async (_e, input: { defaultName: string; content: string }) => {
    const win = getWindow();
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      defaultPath: input.defaultName,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, input.content, "utf8");
    return result.filePath;
  });

  ipcMain.handle("workspace:open", (_e, tokens: Tokens) =>
    withTokens(tokens, async (opts) => {
      const win = getWindow();
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return api.request<WorkspaceInfo>("POST", "/api/workspace/open/", {
        ...opts,
        body: { root_path: result.filePaths[0]! },
      });
    }),
  );

  ipcMain.handle("workspace:getActive", (_e, tokens: Tokens) =>
    withTokens(tokens, (opts) =>
      api
        .request<WorkspaceInfo | undefined>("GET", "/api/workspace/active/", opts)
        .then((ws) => ws ?? null),
    ),
  );

  /**
   * Absolute path of `relPath` inside a workspace. The workspace root comes
   * from the server, never from the renderer, and the result must stay under it.
   */
  async function insideWorkspace(
    opts: { tokens: Tokens; onTokensRefreshed: (t: Tokens) => void },
    workspaceId: string,
    relPath: string,
  ): Promise<string> {
    const page = await api.request<Paginated<WorkspaceInfo>>("GET", "/api/workspace/list/", opts);
    for (const w of page.data) workspaceRoots.set(w.id, w.root_path);
    const ws = page.data.find((w) => w.id === workspaceId);
    if (!ws) throw new Error("Workspace not found");
    const target = containedPath(ws.root_path, relPath);
    if (!target) throw new Error("Path is outside the workspace");
    return target;
  }

  ipcMain.handle("workspace:listDir", (_e, tokens: Tokens, workspaceId: string, relPath: string) =>
    withTokens(tokens, async (opts): Promise<DirEntry[]> => {
      const target = await insideWorkspace(opts, workspaceId, relPath);
      const entries = await readdir(target, { withFileTypes: true });
      return entries
        .filter((d) => !d.name.startsWith("."))
        .map((d): DirEntry => ({ name: d.name, kind: d.isDirectory() ? "dir" : "file" }))
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
    }),
  );

  ipcMain.handle("workspace:readFile", (_e, tokens: Tokens, workspaceId: string, relPath: string) =>
    withTokens(tokens, async (opts): Promise<FileContent> => {
      const target = await insideWorkspace(opts, workspaceId, relPath);
      const info = await stat(target);
      if (!info.isFile()) throw new Error("Not a file");
      const truncated = info.size > FILE_VIEW_LIMIT;
      const buf = await readFile(target);
      const head = truncated ? buf.subarray(0, FILE_VIEW_LIMIT) : buf;
      // A NUL byte in the first 8 KiB is a good-enough binary sniff.
      const binary = head.subarray(0, 8192).includes(0);
      return {
        content: binary ? "" : head.toString("utf8"),
        size: info.size,
        truncated,
        binary,
        modifiedAt: info.mtimeMs,
      };
    }),
  );

  ipcMain.handle("workspace:statFile", (_e, tokens: Tokens, workspaceId: string, relPath: string) =>
    withTokens(tokens, async (opts): Promise<FileStat> => {
      const info = await stat(await insideWorkspace(opts, workspaceId, relPath));
      if (!info.isFile()) throw new Error("Not a file");
      return { size: info.size, modifiedAt: info.mtimeMs };
    }),
  );

  ipcMain.handle("workspace:openExternal", (_e, tokens: Tokens, workspaceId: string, relPath: string) =>
    withTokens(tokens, async (opts): Promise<boolean> => {
      const target = await insideWorkspace(opts, workspaceId, relPath);
      const failure = await shell.openPath(target);
      if (failure) throw new Error(failure);
      return true;
    }),
  );

  ipcMain.handle("workspace:reveal", (_e, tokens: Tokens, workspaceId: string, relPath: string) =>
    withTokens(tokens, async (opts): Promise<boolean> => {
      shell.showItemInFolder(await insideWorkspace(opts, workspaceId, relPath));
      return true;
    }),
  );

  ipcMain.handle("user:updateProfile", (_e, tokens: Tokens, input: { first_name: string; last_name: string }) =>
    withTokens(tokens, (opts) =>
      api.request<AuthUser>("PATCH", "/api/user/me/update/", {
        ...opts,
        body: { first_name: input.first_name.trim(), last_name: input.last_name.trim() },
      }),
    ),
  );

  ipcMain.handle(
    "auth:changePassword",
    (_e, tokens: Tokens, input: { old_password: string; new_password: string }) =>
      withTokens(tokens, async (opts) => {
        const { tokens: fresh } = await api.request<{ tokens: Tokens }>(
          "POST",
          "/api/auth/password-change/",
          { ...opts, body: input },
        );
        return fresh;
      }),
  );

  ipcMain.handle("ai:listProviders", (_e, tokens: Tokens) =>
    withTokens(tokens, (opts) => api.request<LlmProvider[]>("GET", "/api/ai/provider/list/", opts)),
  );

  ipcMain.handle("ai:testProvider", (_e, tokens: Tokens, provider: string, apiKey?: string) =>
    withTokens(tokens, (opts) =>
      api.request<ProviderTestResult>("POST", `/api/ai/provider/${encodeURIComponent(provider)}/test/`, {
        ...opts,
        body: apiKey ? { api_key: apiKey } : {},
      }),
    ),
  );

  ipcMain.handle("ai:createCompletion", (_e, tokens: Tokens, input: CompletionInput) =>
    withTokens(tokens, (opts) =>
      api.request<CompletionOutput>("POST", "/api/ai/completion/create/", { ...opts, body: input }),
    ),
  );

  ipcMain.handle("device:info", () => deviceInfo());

  // ---------------------------------------------------------------- agent

  /** Root of a workspace as the server knows it; the renderer only ever names the id. */
  async function workspaceRoot(
    opts: { tokens: Tokens; onTokensRefreshed: (t: Tokens) => void },
    workspaceId: string,
  ): Promise<string> {
    const cached = workspaceRoots.get(workspaceId);
    if (cached) return cached;
    await insideWorkspace(opts, workspaceId, ".");
    return workspaceRoots.get(workspaceId)!;
  }

  ipcMain.handle("ai:createAgentSession", (_e, tokens: Tokens, input: AgentSessionCreateInput) =>
    withTokens(tokens, async (opts) => {
      // A workspace chat also tells the server the folder it runs in, so the
      // prompt's root and the tool sandbox root are the same path.
      const workspace_path = input.workspace_id ? await workspaceRoot(opts, input.workspace_id) : undefined;
      return api.request<AgentSession>("POST", "/api/ai/agent/session/create/", {
        ...opts,
        body: { ...input, workspace_path, device: deviceInfo() },
      });
    }),
  );

  ipcMain.handle(
    "ai:updateAgentSession",
    (_e, tokens: Tokens, sessionId: string, input: { provider: string; model: string }) =>
      withTokens(tokens, (opts) =>
        api.request<AgentSession>("POST", `/api/ai/agent/session/${encodeURIComponent(sessionId)}/update/`, {
          ...opts,
          body: input,
        }),
      ),
  );

  ipcMain.handle("ai:getAgentSession", (_e, tokens: Tokens, sessionId: string) =>
    withTokens(tokens, (opts) =>
      api.request<AgentSession>("GET", `/api/ai/agent/session/${encodeURIComponent(sessionId)}/details/`, opts),
    ),
  );

  /** Turns in flight, by the renderer's turn id, so approvals and cancels find them. */
  const turns = new Map<string, { turn: AgentTurn; sessionId: string }>();

  ipcMain.handle(
    "ai:runAgentTurn",
    (e, tokens: Tokens, turnId: string, input: { sessionId: string; workspaceId: string; content: string; skill?: string }) =>
      withTokens(tokens, async (opts) => {
        const root = await workspaceRoot(opts, input.workspaceId);
        const turn = new AgentTurn({
          api,
          opts,
          sessionId: input.sessionId,
          workspaceRoot: root,
          emit: (event) => {
            if (!e.sender.isDestroyed()) e.sender.send("ai:agentEvent", turnId, event);
          },
        });
        turns.set(turnId, { turn, sessionId: input.sessionId });
        try {
          await turn.run(input.content, input.skill);
        } finally {
          turns.delete(turnId);
        }
        return null;
      }),
  );

  ipcMain.handle("ai:approveToolCall", (_e, turnId: string, callId: string, decision: ApprovalDecision) => {
    turns.get(turnId)?.turn.approve(callId, decision);
  });

  ipcMain.handle("ai:cancelAgentTurn", (_e, tokens: Tokens, turnId: string) =>
    withTokens(tokens, async (opts) => {
      const entry = turns.get(turnId);
      if (!entry) return null;
      entry.turn.cancel();
      // The server still holds the step's pending calls; drop them so the next message is accepted.
      await api
        .request("POST", `/api/ai/agent/session/${encodeURIComponent(entry.sessionId)}/cancel/`, opts)
        .catch(() => undefined);
      return null;
    }),
  );

  const streams = new Map<string, AbortController>();

  ipcMain.handle("ai:streamCompletion", (e, tokens: Tokens, streamId: string, input: CompletionInput) =>
    withTokens(tokens, async (opts) => {
      const controller = new AbortController();
      streams.set(streamId, controller);
      try {
        await api.stream<CompletionEvent>("/api/ai/completion/stream/", {
          ...opts,
          body: input,
          signal: controller.signal,
          onLine: (event) => {
            if (!e.sender.isDestroyed()) e.sender.send("ai:completionEvent", streamId, event);
          },
        });
      } finally {
        streams.delete(streamId);
      }
      return null;
    }),
  );

  ipcMain.handle("ai:cancelCompletion", (_e, streamId: string) => {
    streams.get(streamId)?.abort();
  });

  ipcMain.handle("ai:transcribe", (_e, tokens: Tokens, input: TranscriptionInput) =>
    withTokens(tokens, (opts) =>
      api.request<TranscriptionOutput>("POST", "/api/ai/transcription/create/", { ...opts, body: input }),
    ),
  );

  ipcMain.handle("ai:listCalls", (_e, tokens: Tokens, query: LlmCallQuery) =>
    withTokens(tokens, (opts) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query ?? {})) {
        if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
      }
      const qs = params.toString();
      return api.request<Paginated<LlmCall>>("GET", `/api/ai/call/list/${qs ? `?${qs}` : ""}`, opts);
    }),
  );

  ipcMain.handle("ai:getCall", (_e, tokens: Tokens, id: string) =>
    withTokens(tokens, (opts) =>
      api.request<LlmCallDetails>("GET", `/api/ai/call/${encodeURIComponent(id)}/details/`, opts),
    ),
  );

  // --------------------------------------------------------------- skills

  ipcMain.handle("ai:listSkills", (_e, tokens: Tokens) =>
    withTokens(tokens, (opts) => api.request<Skill[] | undefined>("GET", "/api/ai/skill/list/", opts).then((s) => s ?? [])),
  );

  ipcMain.handle("ai:installSkill", (_e, tokens: Tokens, input: SkillInstallInput) =>
    withTokens(tokens, (opts) => api.request<InstalledSkill>("POST", "/api/ai/skill/install/", { ...opts, body: input })),
  );

  ipcMain.handle("ai:updateSkill", (_e, tokens: Tokens, name: string, markdown: string) =>
    withTokens(tokens, (opts) =>
      api.request<Skill>("PUT", `/api/ai/skill/${encodeURIComponent(name)}/update/`, { ...opts, body: { markdown } }),
    ),
  );

  ipcMain.handle("ai:deleteSkill", (_e, tokens: Tokens, name: string) =>
    withTokens(tokens, async (opts) => {
      await api.request("DELETE", `/api/ai/skill/${encodeURIComponent(name)}/delete/`, opts);
      return true;
    }),
  );
}
