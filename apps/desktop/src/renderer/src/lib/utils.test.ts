import { strict as assert } from "node:assert";
import { test } from "node:test";

import { cn } from "./utils.js";

test("custom type sizes merge as sizes, not colours", () => {
  assert.equal(cn("bg-black text-sheet", "h-8 text-small"), "bg-black text-sheet h-8 text-small");
  assert.equal(cn("text-body", "text-small"), "text-small");
  assert.equal(cn("text-sheet", "text-slate"), "text-slate");
});
