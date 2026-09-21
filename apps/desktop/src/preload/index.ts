import { contextBridge, ipcRenderer } from "electron";
import type { AgentEvent, CompletionEvent, LocalDictationProgress, PhotonApi } from "./api";

const photonApi: PhotonApi = {
  getInfo: () => ipcRenderer.invoke("app:getInfo"),
  hasUsers: () => ipcRenderer.invoke("auth:hasUsers"),
  register: (input) => ipcRenderer.invoke("auth:register", input),
  login: (email, password) => ipcRenderer.invoke("auth:login", email, password),
  logout: (tokens) => ipcRenderer.invoke("auth:logout", tokens),
  me: (tokens) => ipcRenderer.invoke("auth:me", tokens),
  getSetting: (tokens, key) => ipcRenderer.invoke("settings:get", tokens, key),
  setSetting: (tokens, key, value) => ipcRenderer.invoke("settings:set", tokens, key, value),
  hasApiKey: (tokens, provider) => ipcRenderer.invoke("secrets:hasApiKey", tokens, provider),
  setApiKey: (tokens, provider, apiKey) =>
    ipcRenderer.invoke("secrets:setApiKey", tokens, provider, apiKey),
  deleteApiKey: (tokens, provider) => ipcRenderer.invoke("secrets:deleteApiKey", tokens, provider),
  listWorkspaces: (tokens) => ipcRenderer.invoke("workspace:list", tokens),
  openWorkspace: (tokens) => ipcRenderer.invoke("workspace:open", tokens),
  saveTextFile: (input) => ipcRenderer.invoke("file:saveText", input),
  getActiveWorkspace: (tokens) => ipcRenderer.invoke("workspace:getActive", tokens),
  listWorkspaceDir: (tokens, workspaceId, relPath) =>
    ipcRenderer.invoke("workspace:listDir", tokens, workspaceId, relPath),
  statWorkspaceFile: (tokens, workspaceId, relPath) =>
    ipcRenderer.invoke("workspace:statFile", tokens, workspaceId, relPath),
  readWorkspaceFile: (tokens, workspaceId, relPath) =>
    ipcRenderer.invoke("workspace:readFile", tokens, workspaceId, relPath),
  openWorkspaceFileExternal: (tokens, workspaceId, relPath) =>
    ipcRenderer.invoke("workspace:openExternal", tokens, workspaceId, relPath),
  revealWorkspaceFile: (tokens, workspaceId, relPath) =>
    ipcRenderer.invoke("workspace:reveal", tokens, workspaceId, relPath),
  updateProfile: (tokens, input) => ipcRenderer.invoke("user:updateProfile", tokens, input),
  changePassword: (tokens, input) => ipcRenderer.invoke("auth:changePassword", tokens, input),
  listProviders: (tokens) => ipcRenderer.invoke("ai:listProviders", tokens),
  testProvider: (tokens, provider, apiKey) => ipcRenderer.invoke("ai:testProvider", tokens, provider, apiKey),
  createCompletion: (tokens, input) => ipcRenderer.invoke("ai:createCompletion", tokens, input),
  createAgentSession: (tokens, input) => ipcRenderer.invoke("ai:createAgentSession", tokens, input ?? {}),
  updateAgentSession: (tokens, sessionId, input) => ipcRenderer.invoke("ai:updateAgentSession", tokens, sessionId, input),
  getAgentSession: (tokens, sessionId) => ipcRenderer.invoke("ai:getAgentSession", tokens, sessionId),
  runAgentTurn: (tokens, turnId, input) => ipcRenderer.invoke("ai:runAgentTurn", tokens, turnId, input),
  approveToolCall: (turnId, callId, decision) => ipcRenderer.invoke("ai:approveToolCall", turnId, callId, decision),
  cancelAgentTurn: (tokens, turnId) => ipcRenderer.invoke("ai:cancelAgentTurn", tokens, turnId),
  onAgentEvent: (listener) => {
    const handler = (_e: Electron.IpcRendererEvent, turnId: string, event: AgentEvent) => listener(turnId, event);
    ipcRenderer.on("ai:agentEvent", handler);
    return () => ipcRenderer.removeListener("ai:agentEvent", handler);
  },
  deviceInfo: () => ipcRenderer.invoke("device:info"),
  streamCompletion: (tokens, streamId, input) => ipcRenderer.invoke("ai:streamCompletion", tokens, streamId, input),
  cancelCompletion: (streamId) => ipcRenderer.invoke("ai:cancelCompletion", streamId),
  onCompletionEvent: (listener) => {
    const handler = (_e: Electron.IpcRendererEvent, streamId: string, event: CompletionEvent) =>
      listener(streamId, event);
    ipcRenderer.on("ai:completionEvent", handler);
    return () => ipcRenderer.removeListener("ai:completionEvent", handler);
  },
  transcribe: (tokens, input) => ipcRenderer.invoke("ai:transcribe", tokens, input),
  localDictationStatus: () => ipcRenderer.invoke("dictation:local:status"),
  prepareLocalDictation: () => ipcRenderer.invoke("dictation:local:prepare"),
  transcribeLocally: (pcm, language) => ipcRenderer.invoke("dictation:local:transcribe", pcm, language),
  removeLocalDictationModel: () => ipcRenderer.invoke("dictation:local:remove"),
  onLocalDictationProgress: (listener) => {
    const handler = (_e: Electron.IpcRendererEvent, progress: LocalDictationProgress) => listener(progress);
    ipcRenderer.on("dictation:local:progress", handler);
    return () => ipcRenderer.removeListener("dictation:local:progress", handler);
  },
  listLlmCalls: (tokens, query) => ipcRenderer.invoke("ai:listCalls", tokens, query ?? {}),
  getLlmCall: (tokens, id) => ipcRenderer.invoke("ai:getCall", tokens, id),
};

contextBridge.exposeInMainWorld("photon", photonApi);

export type { PhotonApi };
