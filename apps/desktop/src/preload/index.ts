import { contextBridge, ipcRenderer } from "electron";
import type { PhotonApi } from "./api";

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
  getActiveWorkspace: (tokens) => ipcRenderer.invoke("workspace:getActive", tokens),
  updateProfile: (tokens, input) => ipcRenderer.invoke("user:updateProfile", tokens, input),
  changePassword: (tokens, input) => ipcRenderer.invoke("auth:changePassword", tokens, input),
  listProviders: (tokens) => ipcRenderer.invoke("ai:listProviders", tokens),
  createCompletion: (tokens, input) => ipcRenderer.invoke("ai:createCompletion", tokens, input),
  listLlmCalls: (tokens, query) => ipcRenderer.invoke("ai:listCalls", tokens, query ?? {}),
  getLlmCall: (tokens, id) => ipcRenderer.invoke("ai:getCall", tokens, id),
};

contextBridge.exposeInMainWorld("photon", photonApi);

export type { PhotonApi };
