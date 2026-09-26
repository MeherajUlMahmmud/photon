import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadOverrides, normalizeOverrides } from "./shortcuts.js";

test("keeps well-formed overrides only", () => {
  assert.deepEqual(
    normalizeOverrides({
      "sidebar.toggle": "Command+Shift+S",
      "annotate.tool-pen": " D ",
      "bad id": "X",
      "chat.new": 5,
      "chat.send": "",
      "x.y": "K".repeat(65),
    }),
    { "sidebar.toggle": "Command+Shift+S", "annotate.tool-pen": "D" },
  );
});

test("missing or corrupt file means no overrides", () => {
  const dir = mkdtempSync(join(tmpdir(), "photon-shortcuts-"));
  assert.deepEqual(loadOverrides(join(dir, "none.json")), {});
  writeFileSync(join(dir, "bad.json"), "{nope");
  assert.deepEqual(loadOverrides(join(dir, "bad.json")), {});
});
