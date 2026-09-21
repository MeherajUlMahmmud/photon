import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";
import { ApiClient } from "./api-client.js";
import { registerIpc } from "./ipc.js";

// Resolution order: MAIN_VITE_API_URL from .env (loaded by electron-vite), PHOTON_API_URL at launch, then default.
const API_URL =
  import.meta.env.MAIN_VITE_API_URL ??
  process.env.PHOTON_API_URL ??
  "http://127.0.0.1:8000";

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
  registerIpc({ api: new ApiClient(API_URL), getWindow: () => mainWindow, dialog });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
