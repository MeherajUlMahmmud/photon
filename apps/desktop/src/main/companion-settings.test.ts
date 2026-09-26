import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from "./companion-settings.js";

test("missing or corrupt file gives the defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "photon-companion-"));
  assert.deepEqual(loadSettings(join(dir, "nope.json")), DEFAULT_SETTINGS);
  writeFileSync(join(dir, "bad.json"), "{not json");
  assert.deepEqual(loadSettings(join(dir, "bad.json")), DEFAULT_SETTINGS);
});

test("normalize drops unknown keys and wrong types", () => {
  assert.deepEqual(normalizeSettings({ enabled: "yes", shortcut: "  ", hideOnBlur: true, extra: 1 }), {
    ...DEFAULT_SETTINGS,
    hideOnBlur: true,
  });
});

test("save then load round-trips, creating the folder", () => {
  const file = join(mkdtempSync(join(tmpdir(), "photon-companion-")), "nested", "companion.json");
  const settings = {
    enabled: false,
    shortcut: "Command+Shift+K",
    captureOnOpen: false,
    hideOnBlur: true,
    annotateGesture: false,
    annotateShortcut: "Command+Shift+2",
  };
  saveSettings(file, settings);
  assert.deepEqual(loadSettings(file), settings);
});
