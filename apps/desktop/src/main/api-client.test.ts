import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";

import { ApiClient } from "./api-client.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("parallel refreshes with the same token share one request and one new pair", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const body = { status: "success", status_code: 200, data: { access: `a${calls}`, refresh: `r${calls}` } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  const api = new ApiClient("http://127.0.0.1:1");
  const [first, second] = await Promise.all([api.refresh("old"), api.refresh("old")]);
  // A later caller still holding the old pair (the other window) gets the same result.
  const third = await api.refresh("old");

  assert.equal(calls, 1);
  assert.deepEqual(first, { access: "a1", refresh: "r1" });
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
});

test("a failed refresh is not cached", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    const body =
      calls === 1
        ? { status: "error", status_code: 401, message: "Token is blacklisted" }
        : { status: "success", status_code: 200, data: { access: "a", refresh: "r" } };
    return new Response(JSON.stringify(body), { status: calls === 1 ? 401 : 200 });
  }) as typeof fetch;

  const api = new ApiClient("http://127.0.0.1:1");
  await assert.rejects(api.refresh("old"), /blacklisted/);
  assert.deepEqual(await api.refresh("old"), { access: "a", refresh: "r" });
  assert.equal(calls, 2);
});
