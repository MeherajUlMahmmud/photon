import { strict as assert } from "node:assert";
import { test } from "node:test";

import { LongPressDetector } from "./long-press.js";

/** A fake clock: `tick()` fires whatever timer is pending. */
function setup() {
  let pending: (() => void) | null = null;
  let fired = 0;
  const detector = new LongPressDetector({
    holdMs: 500,
    slopPx: 6,
    onFire: () => (fired += 1),
    setTimer: (fn) => (pending = fn),
    clearTimer: () => (pending = null),
  });
  return {
    detector,
    tick: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
    fired: () => fired,
    armed: () => pending !== null,
  };
}

test("ctrl + left held in place fires once", () => {
  const t = setup();
  t.detector.down({ x: 100, y: 100, button: 1, ctrlKey: true });
  t.detector.move(103, 102);
  t.tick();
  assert.equal(t.fired(), 1);
  t.tick();
  assert.equal(t.fired(), 1);
});

test("no ctrl, other buttons, release or drag do not fire", () => {
  const t = setup();
  t.detector.down({ x: 0, y: 0, button: 1, ctrlKey: false });
  assert.equal(t.armed(), false);
  t.detector.down({ x: 0, y: 0, button: 2, ctrlKey: true });
  assert.equal(t.armed(), false);

  t.detector.down({ x: 0, y: 0, button: 1, ctrlKey: true });
  t.detector.cancel();
  t.tick();

  t.detector.down({ x: 0, y: 0, button: 1, ctrlKey: true });
  t.detector.move(10, 0);
  t.tick();
  assert.equal(t.fired(), 0);
});
