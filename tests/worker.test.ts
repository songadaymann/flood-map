import { test, mock } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index";
const env = {} as Env;
const ctx = {} as ExecutionContext;
const request = (path: string) =>
  worker.fetch(new Request(`https://flood.example${path}`), env, ctx);
const json = (body: unknown) => Response.json(body);

test("Invalid inputs are rejected before any upstream call", async () => {
  const mocked = mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected upstream fetch");
  });
  try {
    for (const path of [
      "/api/flood",
      "/api/flood?lat=&lng=",
      "/api/flood?lat=90&lng=0",
      "/api/tiles/25/1/1.png",
      "/api/tiles/9/512/0.png",
      "/api/search?q=x",
    ])
      assert.equal((await request(path)).status, 400, path);
    assert.equal(mocked.mock.callCount(), 0);
  } finally {
    mocked.mock.restore();
  }
});
test("A FEMA error inside an HTTP 200 response is a failure, not missing coverage", async () => {
  const mocked = mock.method(globalThis, "fetch", async () =>
    json({ error: { code: 500 } }),
  );
  try {
    const result = await request("/api/flood?lat=41.76&lng=-72.74");
    assert.equal(result.status, 503);
    const body = (await result.json()) as Record<string, unknown>;
    assert.ok(!("zones" in body));
  } finally {
    mocked.mock.restore();
  }
});
test("A failed optional panel lookup does not erase a valid flood zone", async () => {
  const mocked = mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request) =>
      String(url).includes("/28/query")
        ? json({ features: [{ attributes: { FLD_ZONE: "AE", SFHA_TF: "T" } }] })
        : json({ error: { code: 500 } }),
  );
  try {
    const result = await request("/api/flood?lat=41.76&lng=-72.74");
    assert.equal(result.status, 200);
    const data = (await result.json()) as {
      zones: { FLD_ZONE: string }[];
      panels: unknown[];
      panelStatus: string;
    };
    assert.equal(data.zones[0].FLD_ZONE, "AE");
    assert.deepEqual(data.panels, []);
    assert.equal(data.panelStatus, "unavailable");
  } finally {
    mocked.mock.restore();
  }
});
test("An empty successful zone query stays empty; it never becomes Zone X", async () => {
  const mocked = mock.method(globalThis, "fetch", async () =>
    json({ features: [] }),
  );
  try {
    const result = await request("/api/flood?lat=0&lng=0");
    assert.equal(result.status, 200);
    assert.deepEqual(((await result.json()) as { zones: unknown[] }).zones, []);
  } finally {
    mocked.mock.restore();
  }
});
test("Truncated or malformed FEMA feature sets cannot produce a normal zone result", async () => {
  for (const body of [
    { features: [], exceededTransferLimit: true },
    {},
    { features: [{}] },
  ]) {
    const mocked = mock.method(globalThis, "fetch", async () => json(body));
    try {
      assert.equal(
        (await request("/api/flood?lat=41.76&lng=-72.74")).status,
        503,
      );
    } finally {
      mocked.mock.restore();
    }
  }
});
test("A transient network error is retried once and a valid response is retained", async () => {
  let calls = 0;
  const mocked = mock.method(globalThis, "fetch", async () => {
    if (++calls === 1) throw new Error("Network reset");
    return json({ result: { addressMatches: [] } });
  });
  try {
    const result = await request("/api/search?q=not%20an%20address");
    assert.equal(result.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(
      ((await result.json()) as { matches: unknown[] }).matches,
      [],
    );
  } finally {
    mocked.mock.restore();
  }
});
