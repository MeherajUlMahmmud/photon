import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentEvent,
  CompletionEvent,
  LocalDictationProgress,
  PhotonApi,
} from "./api";

/** Subscribes to a main-process channel; returns the unsubscribe function. */
function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

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
  listSkills: (tokens) => ipcRenderer.invoke("ai:listSkills", tokens),
  installSkill: (tokens, input) => ipcRenderer.invoke("ai:installSkill", tokens, input),
  updateSkill: (tokens, name, markdown) => ipcRenderer.invoke("ai:updateSkill", tokens, name, markdown),
  deleteSkill: (tokens, name) => ipcRenderer.invoke("ai:deleteSkill", tokens, name),
  companionInfo: () => ipcRenderer.invoke("companion:info"),
  setCompanionSettings: (patch) => ipcRenderer.invoke("companion:setSettings", patch),
  suspendCompanionShortcut: (suspended) => ipcRenderer.invoke("companion:suspendShortcut", suspended),
  captureScreen: () => ipcRenderer.invoke("companion:capture"),
  hideCompanion: () => ipcRenderer.invoke("companion:hide"),
  showCompanion: () => ipcRenderer.invoke("companion:show"),
  openMainWindow: () => ipcRenderer.invoke("companion:openMain"),
  openScreenPermissionSettings: () => ipcRenderer.invoke("companion:openPermissionSettings"),
  onCompanionPending: (listener) => listen<void>("companion:pending", () => listener()),
  takeCompanionPending: () => ipcRenderer.invoke("companion:takePending"),
  startAnnotation: () => ipcRenderer.invoke("annotate:start"),
  requestAccessibility: () => ipcRenderer.invoke("annotate:requestAccessibility"),
  onAnnotateStart: (listener) => listen<void>("annotate:begin", () => listener()),
  takeAnnotationShot: () => ipcRenderer.invoke("annotate:takeShot"),
  submitAnnotation: (input) => ipcRenderer.invoke("annotate:submit", input),
  cancelAnnotation: () => ipcRenderer.invoke("annotate:cancel"),
  onAppAnnotation: (listener) => listen<void>("app:annotation", () => listener()),
  takeAppAnnotation: () => ipcRenderer.invoke("app:takeAnnotation"),
};

contextBridge.exposeInMainWorld("photon", photonApi);

export type { PhotonApi };
