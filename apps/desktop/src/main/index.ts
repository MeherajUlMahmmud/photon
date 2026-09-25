import { app, BrowserWindow, dialog, net, protocol } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ApiClient } from "./api-client.js";
import { cachedWorkspacePath, registerIpc } from "./ipc.js";
import { registerDictationIpc } from "./dictation.js";

/**
 * `photon-file://<workspaceId>/<relative/path>` streams a workspace file to
 * the renderer (images, PDFs). Only paths inside a workspace the renderer has
 * already listed resolve; everything else is a 404.
 */
const FILE_SCHEME = "photon-file";

protocol.registerSchemesAsPrivileged([
  { scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function serveWorkspaceFile(request: Request): Promise<Response> | Response {
  const url = new URL(request.url);
  const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const target = cachedWorkspacePath(url.hostname, relPath);
  if (!target) return new Response("Not found", { status: 404 });
  return net.fetch(pathToFileURL(target).toString());
}

// Resolution order: MAIN_VITE_API_URL from .env (loaded by electron-vite), PHOTON_API_URL at launch, then default.
const API_URL =
  import.meta.env.MAIN_VITE_API_URL ??
  process.env.PHOTON_API_URL ??
  "http://127.0.0.1:8080";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Photon",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  protocol.handle(FILE_SCHEME, serveWorkspaceFile);
  registerIpc({ api: new ApiClient(API_URL), getWindow: () => mainWindow, dialog });
  registerDictationIpc(() => mainWindow);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
