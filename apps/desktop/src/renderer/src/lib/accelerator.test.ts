import { strict as assert } from "node:assert";
import { test } from "node:test";

import { acceleratorFromKey, acceleratorKeys } from "./accelerator.js";

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
  assert.equal(acceleratorFromKey(press("NumpadEnter", { altKey: true }), true).kind, "invalid");
});

test("acceleratorKeys shows symbols on a Mac and names elsewhere", () => {
  assert.deepEqual(acceleratorKeys("Alt+Space", true), ["⌥", "Space"]);
  assert.deepEqual(acceleratorKeys("CommandOrControl+Shift+Space", true), ["⌘", "⇧", "Space"]);
  assert.deepEqual(acceleratorKeys("CommandOrControl+Shift+Space", false), ["Ctrl", "Shift", "Space"]);
});
