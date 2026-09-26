import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from "electron";
import { join } from "node:path";
import type {
  CaptureResult,
  CompanionAttachment,
  CompanionInfo,
  CompanionPending,
  CompanionSettings,
} from "../preload/api.js";
import { centreInside, overlayBounds, OVERLAY_SIZE } from "./companion-layout.js";
import { captureDisplay, screenPermission } from "./screen-capture.js";
import { DEFAULT_SHORTCUT, loadSettings, normalizeSettings, saveSettings } from "./companion-settings.js";

/**
 * The companion: a small always-on-top window summoned from anywhere with a
 * global shortcut. Each summon captures the display under the pointer first,
 * so the model sees what the user was looking at, then shows the overlay.
 * Screenshots stay in memory; they reach the server only inside the one
 * message they were taken for.
 */

/** Used at launch only when the default shortcut is already taken by another app. */
const FALLBACK_SHORTCUT = "CommandOrControl+Shift+Space";
const PRIVACY_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
/** How long the overlay stays transparent while a recapture runs, so the compositor has drawn it gone. */
const HIDE_SETTLE_MS = 120;

export interface CompanionDeps {
  /** Loads the renderer at a hash route in `win`. */
  loadRoute: (win: BrowserWindow, route: string) => void;
  /** Focuses the main window, creating it if needed. */
  openMainWindow: () => void;
  /** Where settings are kept (userData/companion.json). */
  settingsFile: string;
  /** Called after settings or the active shortcut change, e.g. to rebuild the tray menu. */
  onChange: () => void;
  /** The annotate overlay's side of the settings; injected so this module doesn't import it. */
  annotate?: {
    apply: (settings: CompanionSettings) => void;
    info: () => CompanionInfo["annotate"];
    /** Releases (true) or restores (false) the annotate shortcut while Settings records one. */
    suspend: (suspended: boolean) => void;
  };
}

let overlay: BrowserWindow | null = null;
let settings: CompanionSettings = normalizeSettings({});
/** The accelerator currently registered with the OS, or null. */
let shortcut: string | null = null;
let shortcutError: string | null = null;
let quitting = false;
let annotateHooks: CompanionDeps["annotate"];
/**
 * What the overlay has not picked up yet. The window may still be booting
 * (signing in) when a summon happens, so main holds this and pings; the
 * renderer takes it whenever it is ready, exactly once.
 */
let pending: CompanionPending = {};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createOverlay(deps: CompanionDeps): BrowserWindow {
  const win = new BrowserWindow({
    ...OVERLAY_SIZE,
    minWidth: 340,
    minHeight: 360,
    show: false,
    frame: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: "Photon",
    backgroundColor: "#f2f3f1",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // Float above full-screen apps and follow the user across Spaces.
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Keep the overlay out of its own screenshots (and out of screen shares).
  win.setContentProtection(true);
  // Closing only hides it; the conversation lives on until the app quits.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on("closed", () => {
    if (overlay === win) overlay = null;
  });
  win.on("blur", () => {
    // Opacity 0 means a recapture is running; that must not count as leaving.
    if (settings.hideOnBlur && win.getOpacity() > 0) win.hide();
  });
  deps.loadRoute(win, "/companion");
  return win;
}

/** Places the overlay on the display under the pointer unless the user already moved it there. */
function place(win: BrowserWindow): void {
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  if (!centreInside(win.getBounds(), workArea)) win.setBounds(overlayBounds(workArea));
}

function overlayWindow(deps: CompanionDeps): BrowserWindow {
  return overlay && !overlay.isDestroyed() ? overlay : (overlay = createOverlay(deps));
}

async function summon(deps: CompanionDeps): Promise<void> {
  const win = overlayWindow(deps);
  // Capture before showing, so the shot is of the user's screen, not of Photon.
  const capture: CaptureResult = !settings.captureOnOpen
    ? { screenshot: null, permission: screenPermission() }
    : win.isVisible()
      ? await recapture(win)
      : await captureDisplay();
  showOverlay(win, capture);
}

/** Shows the overlay where it belongs and hands the renderer this summon's capture (and an attachment, if any). */
function showOverlay(win: BrowserWindow, capture: CaptureResult, attach?: CompanionAttachment): void {
  if (!win.isVisible()) place(win);
  win.show();
  win.focus();
  pending = { capture, attach: attach ? [...(pending.attach ?? []), attach] : pending.attach };
  const ping = () => win.webContents.send("companion:pending");
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", ping);
  else ping();
}

/**
 * Opens the companion with an image already attached (an annotated
 * screenshot). No fresh capture: the attachment is what the user wants to
 * talk about. With a `note`, the renderer sends it right away.
 */
export function attachToCompanion(deps: CompanionDeps, attach: CompanionAttachment): void {
  showOverlay(overlayWindow(deps), { screenshot: null, permission: screenPermission() }, attach);
}

/** Captures while the overlay is visible: fades it out first, in case content protection is not honoured. */
async function recapture(win: BrowserWindow): Promise<CaptureResult> {
  win.setOpacity(0);
  await wait(HIDE_SETTLE_MS);
  try {
    return await captureDisplay();
  } finally {
    if (!win.isDestroyed()) win.setOpacity(1);
  }
}

/** Shortcut pressed: hide when the overlay has focus, otherwise capture and show. */
function toggle(deps: CompanionDeps): void {
  if (overlay && !overlay.isDestroyed() && overlay.isVisible() && overlay.isFocused()) {
    overlay.hide();
    return;
  }
  void summon(deps);
}

export function companionShortcut(): string | null {
  return shortcut;
}

export function companionEnabled(): boolean {
  return settings.enabled;
}

const NO_ANNOTATE: CompanionInfo["annotate"] = { shortcut: null, shortcutError: null, gestureActive: false, accessibility: "denied" };

export function companionInfo(): CompanionInfo {
  return {
    settings,
    shortcut,
    permission: screenPermission(),
    shortcutError,
    annotate: annotateHooks?.info() ?? NO_ANNOTATE,
  };
}

export function companionSettings(): CompanionSettings {
  return settings;
}

/** Registers `accelerator` in place of the current shortcut. On failure the old one stays and the reason is returned. */
function swapShortcut(accelerator: string, deps: CompanionDeps): string | null {
  const previous = shortcut;
  if (previous === accelerator) return null;
  if (previous) globalShortcut.unregister(previous);
  let ok = false;
  let reason = "another app is already using it";
  try {
    ok = globalShortcut.register(accelerator, () => toggle(deps));
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
  if (ok) {
    shortcut = accelerator;
    return null;
  }
  if (previous) globalShortcut.register(previous, () => toggle(deps));
  return `Couldn't use ${accelerator}: ${reason}.`;
}

function releaseShortcut(): void {
  if (shortcut) globalShortcut.unregister(shortcut);
  shortcut = null;
}

/** Call once from `app.whenReady`. */
export function registerCompanion(deps: CompanionDeps): void {
  settings = loadSettings(deps.settingsFile);
  annotateHooks = deps.annotate;
  if (settings.enabled) {
    shortcutError = swapShortcut(settings.shortcut, deps);
    if (shortcutError && settings.shortcut === DEFAULT_SHORTCUT && !swapShortcut(FALLBACK_SHORTCUT, deps)) {
      shortcutError = null;
    }
    if (shortcutError) console.warn(`[companion] ${shortcutError} Open the companion from the tray.`);
  }

  ipcMain.handle("companion:info", () => companionInfo());
  ipcMain.handle("companion:takePending", () => {
    const taken = pending;
    pending = {};
    return taken;
  });
  ipcMain.handle("companion:setSettings", (_e, patch: Partial<CompanionSettings>) => {
    const next = normalizeSettings({ ...settings, ...patch });
    shortcutError = null;
    if (!next.enabled) {
      releaseShortcut();
      overlay?.hide();
    } else {
      const error = swapShortcut(next.shortcut, deps);
      if (error) {
        // Keep the shortcut that still works; save everything else.
        shortcutError = error;
        next.shortcut = shortcut ?? settings.shortcut;
      }
    }
    settings = next;
    saveSettings(deps.settingsFile, settings);
    annotateHooks?.apply(settings);
    deps.onChange();
    return companionInfo();
  });
  ipcMain.handle("companion:suspendShortcut", (_e, suspended: boolean) => {
    annotateHooks?.suspend(suspended);
    if (suspended) releaseShortcut();
    else if (settings.enabled && !shortcut) swapShortcut(settings.shortcut, deps);
  });
  ipcMain.handle("companion:capture", (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return win && win === overlay && win.isVisible() ? recapture(win) : captureDisplay();
  });
  ipcMain.handle("companion:hide", () => {
    overlay?.hide();
  });
  ipcMain.handle("companion:show", () => (settings.enabled ? summon(deps) : undefined));
  ipcMain.handle("companion:openMain", () => deps.openMainWindow());
  ipcMain.handle("companion:openPermissionSettings", async () => {
    if (process.platform === "darwin") await shell.openExternal(PRIVACY_PANE);
  });

  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
}

export function showCompanion(deps: CompanionDeps): void {
  void summon(deps);
}
