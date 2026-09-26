import { strict as assert } from "node:assert";
import { test } from "node:test";

import { captureSize, centreInside, overlayBounds } from "./companion-layout.js";

test("captureSize keeps native pixels when under the cap", () => {
  assert.deepEqual(captureSize({ width: 1280, height: 800 }, 1), { width: 1280, height: 800 });
});

test("captureSize scales a retina display down to the long-edge cap, keeping aspect", () => {
  assert.deepEqual(captureSize({ width: 1512, height: 982 }, 2), { width: 1568, height: 1018 });
  assert.deepEqual(captureSize({ width: 1080, height: 1920 }, 1), { width: 882, height: 1568 });
});

test("overlayBounds pins to the top-right of the work area", () => {
  const area = { x: 0, y: 25, width: 1512, height: 900 };
  assert.deepEqual(overlayBounds(area), { x: 1512 - 420 - 16, y: 41, width: 420, height: 560 });
});

test("overlayBounds shrinks to fit a small display", () => {
  const b = overlayBounds({ x: 100, y: 0, width: 400, height: 500 });
  assert.equal(b.width, 368);
  assert.equal(b.height, 468);
  assert.equal(b.x, 116);
});

test("centreInside follows the rect's centre, not its edges", () => {
  const area = { x: 0, y: 0, width: 1000, height: 800 };
  assert.ok(centreInside({ x: 900, y: 10, width: 180, height: 100 }, area));
  assert.ok(!centreInside({ x: 950, y: 10, width: 200, height: 100 }, area));
});
