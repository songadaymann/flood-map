import { test, mock } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index";
import type { NearbyRivers, RiverConditions } from "../src/rivers";

const metadata = () => ({
  lid: "NBPC3",
  name: "North Branch Park River at Hartford",
  inService: { enabled: true },
  status: {
    observed: {
      primary: 0,
      primaryUnit: "ft",
      validTime: "2026-10-16T19:45:00Z",
      floodCategory: "no_flooding",
    },
    forecast: { floodCategory: "no_flooding" },
  },
  flood: {
    stageUnits: "ft",
    flowUnits: "cfs",
    categories: { minor: { stage: 8, flow: -9999 } },
  },
});

async function noaaTest(
  run: (
    request: (path: string) => Promise<Response>,
    entries: Map<string, Response>,
  ) => Promise<void>,
) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const entries = new Map<string, Response>();
  const pending: Promise<unknown>[] = [];
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      open: async () => ({
        match: async (key: Request) => entries.get(key.url)?.clone(),
        put: async (key: Request, response: Response) => {
          entries.set(key.url, response);
        },
      }),
    },
  });
  const context = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  } as ExecutionContext;
  try {
    await run(
      (path) =>
        worker.fetch(
          new Request(`https://flood.example${path}`),
          {} as Env,
          context,
        ),
      entries,
    );
    await Promise.all(pending);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "caches", descriptor);
    else Reflect.deleteProperty(globalThis, "caches");
  }
}

test("NOAA discovery is bounded, sorted by distance, and capped at five nearby gauges", async () => {
  await noaaTest(async (request, entries) => {
    const fetcher = mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request) => {
        const url = new URL(String(input));
        assert.equal(url.hostname, "api.water.noaa.gov");
        assert.equal(url.searchParams.get("srid"), "EPSG_4326");
        assert.ok(url.searchParams.has("bbox.xmin"));
        return Response.json({
          gauges: [
            ...Array.from({ length: 8 }, (_, i) => ({
              lid: `TEST${i}`,
              name: `River ${i}`,
              latitude: 41.76 + i * 0.01,
              longitude: -72.74,
            })),
            {
              lid: "DISTANT",
              name: "Far away",
              latitude: 43,
              longitude: -72.74,
            },
            {
              lid: "DISABLED",
              name: "Closed gauge",
              latitude: 41.76,
              longitude: -72.74,
              inService: { enabled: false },
            },
          ],
        });
      },
    );
    try {
      const response = await request("/api/rivers?lat=41.76&lng=-72.74");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      const body = (await response.json()) as NearbyRivers;
      assert.equal(body.gauges.length, 5);
      assert.equal(body.gauges[0].id, "TEST0");
      assert.ok(body.gauges.every((gauge) => gauge.distanceMiles <= 25));
      assert.equal(
        [...entries.values()][0].headers.get("Cache-Control"),
        "public, max-age=300",
      );
      await request("/api/rivers?lat=41.77&lng=-72.73");
      assert.equal(
        fetcher.mock.callCount(),
        1,
        "Nearby points reuse a regional discovery",
      );
    } finally {
      fetcher.mock.restore();
    }
  });
});

test("NOAA uses the official forecast product; zero levels survive and sentinels do not", async () => {
  await noaaTest(async (request) => {
    const fetcher = mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request) => {
        const url = String(input);
        assert.ok(!url.includes("/reaches/"));
        return Response.json(
          url.endsWith("/stageflow/forecast")
            ? {
                issuedTime: "2026-10-16T18:00:00Z",
                primaryUnits: "ft",
                data: [
                  { primary: -0.2, validTime: "2026-10-17T00:00:00Z" },
                  { primary: -999, validTime: "2026-10-17T01:00:00Z" },
                  { primary: -9999, validTime: "2026-10-17T02:00:00Z" },
                  { primary: 2, validTime: "0001-01-01T00:00:00Z" },
                ],
              }
            : metadata(),
        );
      },
    );
    try {
      const response = await request("/api/rivers/nbpc3");
      assert.equal(response.status, 200);
      const data = (await response.json()) as RiverConditions;
      assert.equal(data.observed?.value, 0);
      assert.equal(data.forecast.state, "issued");
      assert.equal(data.forecast.readings.length, 1);
      assert.equal(data.forecast.readings[0].value, -0.2);
      assert.deepEqual(data.thresholds, [
        { category: "minor", value: 8, unit: "ft" },
      ]);
      assert.equal(fetcher.mock.callCount(), 2);
      await request("/api/rivers/NBPC3");
      assert.equal(
        fetcher.mock.callCount(),
        2,
        "Gauge products are cached independently",
      );
    } finally {
      fetcher.mock.restore();
    }
  });
});

test("A failed NOAA forecast preserves the observation and never invents a forecast", async () => {
  await noaaTest(async (request) => {
    const fetcher = mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request) =>
        Response.json(
          String(input).endsWith("/forecast")
            ? { error: { message: "Unavailable" } }
            : metadata(),
        ),
    );
    try {
      const response = await request("/api/rivers/NBPC3");
      assert.equal(response.status, 200);
      const data = (await response.json()) as RiverConditions;
      assert.equal(data.observed?.value, 0);
      assert.equal(data.forecast.state, "unavailable");
      assert.deepEqual(data.forecast.readings, []);
    } finally {
      fetcher.mock.restore();
    }
  });
});

test("An empty official forecast is distinct from a NOAA failure", async () => {
  await noaaTest(async (request) => {
    const fetcher = mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request) =>
        Response.json(
          String(input).endsWith("/forecast")
            ? { issuedTime: "0001-01-01T00:00:00Z", primaryUnits: "", data: [] }
            : metadata(),
        ),
    );
    try {
      const data = (await (
        await request("/api/rivers/NBPC3")
      ).json()) as RiverConditions;
      assert.equal(data.forecast.state, "not-issued");
    } finally {
      fetcher.mock.restore();
    }
  });
});

test("NOAA's unlocated 0,0 stations are excluded rather than shown at an ocean point", async () => {
  await noaaTest(async (request) => {
    const fetcher = mock.method(globalThis, "fetch", async () =>
      Response.json({
        gauges: [
          {
            lid: "BZCM8",
            name: "Bozeman Creek at Bozeman, MT",
            latitude: 0,
            longitude: 0,
          },
        ],
      }),
    );
    try {
      const response = await request("/api/rivers?lat=0&lng=0");
      assert.equal(response.status, 200);
      assert.deepEqual(((await response.json()) as NearbyRivers).gauges, []);
    } finally {
      fetcher.mock.restore();
    }
  });
});

test("Malformed NOAA discovery is unavailable, while a valid empty area remains empty", async () => {
  for (const body of [
    { error: "Bad query" },
    {},
    { gauges: [{}] },
    { gauges: [] },
  ]) {
    await noaaTest(async (request) => {
      const fetcher = mock.method(globalThis, "fetch", async () =>
        Response.json(body),
      );
      try {
        const response = await request("/api/rivers?lat=0&lng=0");
        assert.equal(
          response.status,
          "gauges" in body && body.gauges?.length === 0 ? 200 : 503,
        );
      } finally {
        fetcher.mock.restore();
      }
    });
  }
});
