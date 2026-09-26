import { BrowserWindow, ipcMain } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ShortcutOverrides } from "../preload/api.js";

/**
 * In-app shortcut overrides (the renderer's keymap owns the actions and their
 * defaults). Kept in main so the main window, the companion and the annotate
 * overlay all read one copy and hear about changes at once. Per machine, in
 * userData/shortcuts.json. The two global shortcuts live in companion.json.
 */

const ACTION_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;
const MAX_ACCELERATOR = 64;

/** Keeps well-formed entries only, so a hand-edited file can't break the keymap. */
export function normalizeOverrides(raw: unknown): ShortcutOverrides {
  const out: ShortcutOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (ACTION_ID.test(id) && typeof value === "string" && value.trim() && value.length <= MAX_ACCELERATOR) {
      out[id] = value.trim();
    }
  }
  return out;
}

export function loadOverrides(file: string): ShortcutOverrides {
  try {
    return normalizeOverrides(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

function saveOverrides(file: string, overrides: ShortcutOverrides): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(overrides, null, 2));
}

export function registerShortcuts(file: string): void {
  let overrides = loadOverrides(file);

  const broadcast = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("shortcuts:changed", overrides);
    }
  };

  ipcMain.handle("shortcuts:get", () => overrides);
  /** `accelerator` null resets the action to its default; `id` null resets everything. */
  ipcMain.handle("shortcuts:set", (_e, id: string | null, accelerator: string | null) => {
    if (id === null) overrides = {};
    else if (!ACTION_ID.test(id)) throw new Error(`Unknown shortcut action '${id}'.`);
    else if (accelerator === null) {
      const { [id]: _, ...rest } = overrides;
      overrides = rest;
    } else {
      overrides = normalizeOverrides({ ...overrides, [id]: accelerator });
    }
    saveOverrides(file, overrides);
    broadcast();
    return overrides;
  });
}
