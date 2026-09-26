import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell, systemPreferences } from "electron";
import { join } from "node:path";
import { uIOhook } from "uiohook-napi";
import type {
  AccessibilityPermission,
  AnnotationSubmit,
  AppAnnotation,
  CompanionInfo,
  CompanionSettings,
  Screenshot,
} from "../preload/api.js";
import { attachToCompanion, companionInfo, showCompanion, type CompanionDeps } from "./companion.js";
import { LongPressDetector } from "./long-press.js";
import { captureDisplay } from "./screen-capture.js";

/**
 * The annotate overlay: Ctrl + long press (or a shortcut) freezes the screen
 * under a dark tint, the user draws on it, and the marked-up picture goes to
 * the companion or to a new chat in the main window. Nothing is stored.
 *
 * Seeing a mouse press outside our own windows needs a global input hook
 * (uiohook-napi), which macOS only allows with Accessibility trust.
 */

const HOLD_MS = 450;
const SLOP_PX = 6;
/** Captured sharper than the companion's 1568 px so strokes line up; the renderer downsizes on export. */
const ANNOTATE_CAPTURE_EDGE = 2560;
const ACCESSIBILITY_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

export interface AnnotateDeps {
  loadRoute: (win: BrowserWindow, route: string) => void;
  companion: CompanionDeps;
  openMainWindow: () => void;
  getMainWindow: () => BrowserWindow | null;
}

let deps: AnnotateDeps | null = null;
let overlay: BrowserWindow | null = null;
let quitting = false;
let busy = false;
let hookRunning = false;
let hookError: string | null = null;
let shortcut: string | null = null;
let shortcutError: string | null = null;
let wanted = { enabled: false, gesture: false, shortcut: "" };
// Held until the target window takes them: a window that is still loading would miss a pushed event.
let pendingShot: Screenshot | null = null;
let pendingForApp: AppAnnotation | null = null;

const detector = new LongPressDetector({ holdMs: HOLD_MS, slopPx: SLOP_PX, onFire: () => void startAnnotation() });

function accessibility(): AccessibilityPermission {
  if (process.platform !== "darwin") return "granted";
  return systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "denied";
}

// ------------------------------------------------------------------ hook

function startHook(): void {
  if (hookRunning || accessibility() !== "granted") return;
  try {
    uIOhook.on("mousedown", (e) => detector.down({ x: e.x, y: e.y, button: Number(e.button), ctrlKey: e.ctrlKey }));
    uIOhook.on("mousemove", (e) => detector.move(e.x, e.y));
    // Mouse events only: Ctrl comes from the press's modifier flags, so no keystroke is ever read.
    uIOhook.on("mouseup", () => detector.cancel());
    uIOhook.start();
    hookRunning = true;
    hookError = null;
  } catch (err) {
    uIOhook.removeAllListeners();
    hookError = err instanceof Error ? err.message : String(err);
    console.warn("[annotate] mouse hook failed:", err);
  }
}

function stopHook(): void {
  if (!hookRunning) return;
  detector.cancel();
  uIOhook.removeAllListeners();
  try {
    uIOhook.stop();
  } catch (err) {
    console.warn("[annotate] mouse hook stop failed:", err);
  }
  hookRunning = false;
}

// -------------------------------------------------------------- shortcut

function applyShortcut(accelerator: string | null): void {
  shortcutError = null;
  if (shortcut === accelerator) return;
  if (shortcut) globalShortcut.unregister(shortcut);
  shortcut = null;
  if (!accelerator) return;
  try {
    if (globalShortcut.register(accelerator, () => void startAnnotation())) shortcut = accelerator;
    else shortcutError = `Couldn't use ${accelerator}: another app is already using it.`;
  } catch (err) {
    shortcutError = `Couldn't use ${accelerator}: ${err instanceof Error ? err.message : String(err)}.`;
  }
}

/** Brings the hook and the shortcut in line with settings. Called at launch and on every settings change. */
export function applyAnnotateSettings(settings: CompanionSettings): void {
  wanted = { enabled: settings.enabled, gesture: settings.annotateGesture, shortcut: settings.annotateShortcut };
  applyShortcut(settings.enabled ? settings.annotateShortcut : null);
  if (settings.enabled && settings.annotateGesture) startHook();
  else stopHook();
}

/** Settings is recording a shortcut: let go of ours so the keys reach the recorder. */
export function suspendAnnotateShortcut(suspended: boolean): void {
  if (suspended) applyShortcut(null);
  else applyShortcut(wanted.enabled ? wanted.shortcut : null);
}

export function annotateInfo(): CompanionInfo["annotate"] {
  return {
    shortcut,
    shortcutError: shortcutError ?? (wanted.gesture && hookError ? `Mouse gesture unavailable: ${hookError}` : null),
    gestureActive: hookRunning,
    accessibility: accessibility(),
  };
}

// --------------------------------------------------------------- overlay

function createOverlay(d: AnnotateDeps): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    alwaysOnTop: true,
    backgroundColor: "#141517",
    title: "Photon annotate",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // Above everything, menu bar and full-screen apps included; kept out of its own captures.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(true);
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on("closed", () => {
    if (overlay === win) overlay = null;
  });
  d.loadRoute(win, "/annotate");
  return win;
}

function overlayWindow(d: AnnotateDeps): BrowserWindow {
  return overlay && !overlay.isDestroyed() ? overlay : (overlay = createOverlay(d));
}

/** Freezes the display under the pointer and opens the overlay on it. */
export async function startAnnotation(): Promise<void> {
  const d = deps;
  if (!d || busy || !wanted.enabled) return;
  busy = true;
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const capture = await captureDisplay(ANNOTATE_CAPTURE_EDGE, 88);
    if (!capture.screenshot) {
      // No screen permission: the companion explains how to grant it.
      showCompanion(d.companion);
      return;
    }
    const win = overlayWindow(d);
    const shot: Screenshot = capture.screenshot;
    win.setBounds(display.bounds);
    pendingShot = shot;
    const begin = () => {
      win.webContents.send("annotate:begin");
      win.show();
      // Take keyboard focus from whatever app was in front, so Esc and typing reach the overlay.
      app.focus({ steal: true });
      win.focus();
    };
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", begin);
    else begin();
  } finally {
    busy = false;
  }
}

function submit(d: AnnotateDeps, input: AnnotationSubmit): void {
  overlay?.hide();
  if (input.target === "companion") {
    attachToCompanion(d.companion, { image: input.image, name: "Annotated screen", note: input.note });
    return;
  }
  d.openMainWindow();
  const main = d.getMainWindow();
  if (!main) return;
  pendingForApp = { image: input.image, note: input.note };
  const ping = () => main.webContents.send("app:annotation");
  if (main.webContents.isLoading()) main.webContents.once("did-finish-load", ping);
  else ping();
}

/** Call once from `app.whenReady`, after `registerCompanion` (settings are loaded there). */
export function registerAnnotate(d: AnnotateDeps, settings: CompanionSettings): void {
  deps = d;
  applyAnnotateSettings(settings);
  // Load the overlay page now so the first long press opens instantly.
  overlayWindow(d);

  ipcMain.handle("annotate:start", () => startAnnotation());
  ipcMain.handle("annotate:takeShot", () => {
    const shot = pendingShot;
    pendingShot = null;
    return shot;
  });
  ipcMain.handle("app:takeAnnotation", () => {
    const taken = pendingForApp;
    pendingForApp = null;
    return taken;
  });
  ipcMain.handle("annotate:submit", (_e, input: AnnotationSubmit) => submit(d, input));
  ipcMain.handle("annotate:cancel", () => {
    overlay?.hide();
  });
  ipcMain.handle("annotate:requestAccessibility", async () => {
    if (process.platform === "darwin" && !systemPreferences.isTrustedAccessibilityClient(true)) {
      await shell.openExternal(ACCESSIBILITY_PANE);
    }
    if (wanted.enabled && wanted.gesture) startHook();
    return companionInfo();
  });

  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => stopHook());
}
