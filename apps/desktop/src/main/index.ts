import { app, BrowserWindow, dialog, Menu, nativeImage, net, protocol, Tray } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ApiClient } from "./api-client.js";
import { cachedWorkspacePath, registerIpc } from "./ipc.js";
import { registerDictationIpc } from "./dictation.js";
import {
  companionEnabled,
  companionSettings,
  companionShortcut,
  registerCompanion,
  showCompanion,
  type CompanionDeps,
} from "./companion.js";
import {
  annotateInfo,
  applyAnnotateSettings,
  registerAnnotate,
  startAnnotation,
  suspendAnnotateShortcut,
} from "./annotate.js";

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
// Held so the menu-bar icon is not garbage-collected.
let tray: Tray | null = null;

/** Loads the renderer at a hash route: the dev server in development, the built file otherwise. */
function loadRoute(win: BrowserWindow, route: string): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${route}`);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"), { hash: route });
  }
}

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
  mainWindow.on("closed", () => {
    mainWindow = null;
    // The hidden companion overlay keeps a window alive, so quit here rather than on window-all-closed.
    if (process.platform !== "darwin") app.quit();
  });
  loadRoute(mainWindow, "/");
}

function openMainWindow(): void {
  if (!mainWindow) createWindow();
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

/** Rebuilt whenever companion settings change, so the menu shows the current shortcut. */
function updateTrayMenu(): void {
  if (!tray) return;
  const shortcut = companionShortcut();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...(companionEnabled()
        ? [
            { label: "Ask Photon", accelerator: shortcut ?? undefined, click: () => showCompanion(companion) },
            {
              label: "Annotate screen",
              accelerator: annotateInfo().shortcut ?? undefined,
              click: () => void startAnnotation(),
            },
          ]
        : []),
      { label: "Open Photon", click: openMainWindow },
      { type: "separator" },
      { label: "Quit Photon", role: "quit" },
    ]),
  );
}

const companion: CompanionDeps = {
  loadRoute,
  openMainWindow,
  settingsFile: join(app.getPath("userData"), "companion.json"),
  onChange: updateTrayMenu,
  annotate: { apply: applyAnnotateSettings, info: annotateInfo, suspend: suspendAnnotateShortcut },
};

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, "../../resources/trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Photon");
  updateTrayMenu();
}

app.whenReady().then(() => {
  protocol.handle(FILE_SCHEME, serveWorkspaceFile);
  registerIpc({ api: new ApiClient(API_URL), getWindow: () => mainWindow, dialog });
  registerDictationIpc();
  registerCompanion(companion);
  registerAnnotate({ loadRoute, companion, openMainWindow, getMainWindow: () => mainWindow }, companionSettings());

  createWindow();
  createTray();

  app.on("activate", () => {
    if (!mainWindow) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
