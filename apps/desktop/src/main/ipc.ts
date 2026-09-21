import type { BrowserWindow, Dialog } from "electron";
import { ipcMain } from "electron";
import { readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type {
  AuthResult,
  AuthSession,
  AuthUser,
  CompletionInput,
  CompletionOutput,
  DirEntry,
  LlmCall,
  LlmCallDetails,
  LlmCallQuery,
  LlmProvider,
  Page,
  RegisterInput,
  Tokens,
  WithTokens,
  WorkspaceInfo,
} from "../preload/api.js";
import { ApiError, type ApiClient } from "./api-client.js";

export interface IpcDeps {
  api: ApiClient;
  getWindow: () => BrowserWindow | null;
  dialog: Dialog;
}

type Paginated<T> = Page<T>;

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

  ipcMain.handle("workspace:listDir", (_e, tokens: Tokens, workspaceId: string, relPath: string) =>
    withTokens(tokens, async (opts): Promise<DirEntry[]> => {
      // The workspace root comes from the server, never from the renderer, and
      // the requested path must stay inside it.
      const page = await api.request<Paginated<WorkspaceInfo>>("GET", "/api/workspace/list/", opts);
      const ws = page.data.find((w) => w.id === workspaceId);
      if (!ws) throw new Error("Workspace not found");
      const root = resolve(ws.root_path);
      const target = resolve(root, relPath || ".");
      const rel = relative(root, target);
      if (rel.startsWith("..") || rel.startsWith(sep) || resolve(root, rel) !== target) {
        throw new Error("Path is outside the workspace");
      }
      const entries = await readdir(target, { withFileTypes: true });
      return entries
        .filter((d) => !d.name.startsWith("."))
        .map((d): DirEntry => ({ name: d.name, kind: d.isDirectory() ? "dir" : "file" }))
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
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

  ipcMain.handle("ai:createCompletion", (_e, tokens: Tokens, input: CompletionInput) =>
    withTokens(tokens, (opts) =>
      api.request<CompletionOutput>("POST", "/api/ai/completion/create/", { ...opts, body: input }),
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
}
