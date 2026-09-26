import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CompanionSettings } from "../preload/api.js";

/**
 * Companion preferences are per machine, not per account: the shortcut has to
 * be registered at launch, before anyone signs in. Stored as JSON in the
 * app's userData folder.
 */

export const DEFAULT_SHORTCUT = "Alt+Space";
export const DEFAULT_ANNOTATE_SHORTCUT = "Alt+Shift+Space";

export const DEFAULT_SETTINGS: CompanionSettings = {
  enabled: true,
  shortcut: DEFAULT_SHORTCUT,
  captureOnOpen: true,
  hideOnBlur: false,
  annotateGesture: true,
  annotateShortcut: DEFAULT_ANNOTATE_SHORTCUT,
};

/** Keeps only known keys with the right types, so a hand-edited or older file can't break startup. */
export function normalizeSettings(raw: unknown): CompanionSettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bool = (key: keyof CompanionSettings) =>
    typeof src[key] === "boolean" ? (src[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean);
  const text = (key: keyof CompanionSettings, fallback: string) =>
    typeof src[key] === "string" && (src[key] as string).trim() ? (src[key] as string).trim() : fallback;
  return {
    enabled: bool("enabled"),
    shortcut: text("shortcut", DEFAULT_SHORTCUT),
    captureOnOpen: bool("captureOnOpen"),
    hideOnBlur: bool("hideOnBlur"),
    annotateGesture: bool("annotateGesture"),
    annotateShortcut: text("annotateShortcut", DEFAULT_ANNOTATE_SHORTCUT),
  };
}

export function loadSettings(file: string): CompanionSettings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(file: string, settings: CompanionSettings): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2));
}
