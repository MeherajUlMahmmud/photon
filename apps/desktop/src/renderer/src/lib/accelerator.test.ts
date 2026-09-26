import { strict as assert } from "node:assert";
import { test } from "node:test";

import { acceleratorFromKey, acceleratorKeys, canonicalAccelerator, matchesAccelerator } from "./accelerator.js";

const press = (code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test("builds accelerators from physical keys in a fixed modifier order", () => {
  assert.deepEqual(acceleratorFromKey(press("KeyK", { shiftKey: true, metaKey: true }), true), {
    kind: "accelerator",
    accelerator: "Command+Shift+K",
  });
  assert.deepEqual(acceleratorFromKey(press("Space", { altKey: true }), true), {
    kind: "accelerator",
    accelerator: "Alt+Space",
  });
  assert.deepEqual(acceleratorFromKey(press("Digit1", { metaKey: true }), false), {
    kind: "accelerator",
    accelerator: "Super+1",
  });
});

test("modifier-only presses keep listening; bare keys are refused except F-keys", () => {
  assert.equal(acceleratorFromKey(press("AltLeft", { altKey: true }), true).kind, "pending");
  assert.equal(acceleratorFromKey(press("KeyA"), true).kind, "invalid");
  assert.equal(acceleratorFromKey(press("KeyA", { shiftKey: true }), true).kind, "invalid");
  assert.deepEqual(acceleratorFromKey(press("F13"), true), { kind: "accelerator", accelerator: "F13" });
  assert.equal(acceleratorFromKey(press("NumpadAdd", { altKey: true }), true).kind, "invalid");
});

test("acceleratorKeys shows symbols on a Mac and names elsewhere", () => {
  assert.deepEqual(acceleratorKeys("Alt+Space", true), ["⌥", "Space"]);
  assert.deepEqual(acceleratorKeys("CommandOrControl+Shift+Space", true), ["⌘", "⇧", "Space"]);
  assert.deepEqual(acceleratorKeys("CommandOrControl+Shift+Space", false), ["Ctrl", "Shift", "Space"]);
});

test("bare keys are allowed only when asked for", () => {
  assert.equal(acceleratorFromKey(press("KeyP"), true).kind, "invalid");
  assert.deepEqual(acceleratorFromKey(press("KeyP"), true, { allowBare: true }), { kind: "accelerator", accelerator: "P" });
  assert.deepEqual(acceleratorFromKey(press("Escape"), true, { allowBare: true }), { kind: "accelerator", accelerator: "Escape" });
});

test("canonical form resolves platform modifiers and ordering", () => {
  assert.equal(canonicalAccelerator("Shift+CommandOrControl+b", true), "Command+Shift+B");
  assert.equal(canonicalAccelerator("CmdOrCtrl+B", false), "Control+B");
  assert.equal(canonicalAccelerator("Option+Esc", true), "Alt+Escape");
});

test("matching is exact: extra modifiers do not match", () => {
  assert.ok(matchesAccelerator(press("KeyB", { metaKey: true }), "CommandOrControl+B", true));
  assert.ok(matchesAccelerator(press("KeyB", { ctrlKey: true }), "CommandOrControl+B", false));
  assert.ok(!matchesAccelerator(press("KeyB", { metaKey: true, shiftKey: true }), "CommandOrControl+B", true));
  assert.ok(matchesAccelerator(press("Enter"), "Enter", true));
  assert.ok(!matchesAccelerator(press("Enter", { shiftKey: true }), "Enter", true));
});
