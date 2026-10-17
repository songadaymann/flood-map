import {
  RIVER_RADIUS_MILES,
  type NearbyRivers,
  type RiverCategory,
  type RiverConditions,
  type RiverReading,
} from "../src/rivers";
import { UpstreamError, fetchUpstream, readJson } from "./upstream";

const NOAA_API = "https://api.water.noaa.gov/nwps/v1";
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const text = (value: unknown, max = 160) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const value = (input: unknown) =>
  typeof input === "number" &&
  Number.isFinite(input) &&
  ![-999, -9999, -99999, -8888].includes(input)
    ? input
    : null;
const unit = (input: unknown) => text(input, 20);
const timestamp = (input: unknown) => {
  const time = typeof input === "string" ? Date.parse(input) : NaN;
  return Number.isFinite(time) && time >= Date.UTC(2000, 0, 1)
    ? new Date(time).toISOString()
    : null;
};
const reading = (input: unknown, units: unknown): RiverReading | null => {
  const datum = object(input);
  const number = value(datum.primary);
  const validAt = timestamp(datum.validTime);
  const label = unit(units);
  return number !== null && validAt && label
    ? { value: number, unit: label, validAt }
    : null;
};

async function cachedNoaa<T>(
  path: string,
  ttl: number,
  ctx: ExecutionContext,
  parse: (data: JsonObject) => T,
): Promise<T> {
  const cache = await caches.open("noaa-rivers-v1");
  const key = new Request(`${NOAA_API}${path}`);
  const cached = await cache.match(key);
  if (cached) return await readJson<T>(cached);
  const raw = object(
    await readJson<unknown>(await fetchUpstream(key.url, 8000)),
  );
  if (raw.error || raw.code)
    throw new UpstreamError("NOAA returned an invalid response.");
  const result = parse(raw);
  ctx.waitUntil(
    cache
      .put(
        key,
        Response.json(result, {
          headers: { "Cache-Control": `public, max-age=${ttl}` },
        }),
      )
      .catch(() => undefined),
  );
  return result;
}

export function distanceMiles(
  lng: number,
  lat: number,
  otherLng: number,
  otherLat: number,
) {
  const radians = Math.PI / 180;
  const a =
    Math.sin(((otherLat - lat) * radians) / 2) ** 2 +
    Math.cos(lat * radians) *
      Math.cos(otherLat * radians) *
      Math.sin(((otherLng - lng) * radians) / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function gaugeSearchBounds(lng: number, lat: number) {
  // Reuse regional discoveries as people move the pin, with a full 25-mile
  // margin around each half-degree cell. Exact distance is checked afterwards.
  const cellLat = Math.floor(lat * 2) / 2;
  const cellLng = Math.floor(lng * 2) / 2;
  const latMargin = RIVER_RADIUS_MILES / 68.5;
  const ymin = Math.max(-90, cellLat - latMargin);
  const ymax = Math.min(90, cellLat + 0.5 + latMargin);
  const lngMargin =
    RIVER_RADIUS_MILES /
    (68.5 *
      Math.cos((Math.max(Math.abs(ymin), Math.abs(ymax)) * Math.PI) / 180));
  const xmin = cellLng - lngMargin;
  const xmax = cellLng + 0.5 + lngMargin;
  const ranges =
    xmin < -180
      ? [
          [xmin + 360, 180],
          [-180, xmax],
        ]
      : xmax > 180
        ? [
            [xmin, 180],
            [-180, xmax - 360],
          ]
        : [[xmin, xmax]];
  return ranges.map(([left, right]) => ({
    xmin: left,
    ymin,
    xmax: right,
    ymax,
  }));
}

export async function nearbyRivers(
  lng: number,
  lat: number,
  ctx: ExecutionContext,
): Promise<NearbyRivers> {
  const regions = await Promise.all(
    gaugeSearchBounds(lng, lat).map((bounds) => {
      const params = new URLSearchParams({ srid: "EPSG_4326" });
      for (const [key, number] of Object.entries(bounds))
        params.set(`bbox.${key}`, number.toFixed(6));
      return cachedNoaa(`/gauges?${params}`, 300, ctx, (raw) => {
        if (!Array.isArray(raw.gauges))
          throw new UpstreamError("NOAA did not return a gauge list.");
        return raw.gauges.flatMap((input: unknown) => {
          const gauge = object(input);
          const id = text(gauge.lid, 12).toUpperCase();
          const name = text(gauge.name);
          const latitude = value(gauge.latitude);
          const longitude = value(gauge.longitude);
          if (object(gauge.inService).enabled === false) return [];
          if (
            !/^[A-Z0-9]{3,12}$/.test(id) ||
            !name ||
            latitude === null ||
            longitude === null ||
            Math.abs(latitude) > 90 ||
            Math.abs(longitude) > 180
          )
            throw new UpstreamError("NOAA returned an invalid gauge record.");
          return [{ id, name, latitude, longitude }];
        });
      });
    }),
  );
  const unique = new Map(regions.flat().map((gauge) => [gauge.id, gauge]));
  const gauges = [...unique.values()]
    // NOAA has a few unlocated stations stored at 0,0. This is a placeholder,
    // not a real river gauge in the Gulf of Guinea.
    .filter((gauge) => gauge.latitude !== 0 || gauge.longitude !== 0)
    .map((gauge) => ({
      id: gauge.id,
      name: gauge.name,
      distanceMiles: distanceMiles(lng, lat, gauge.longitude, gauge.latitude),
    }))
    .filter((gauge) => gauge.distanceMiles <= RIVER_RADIUS_MILES)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, 5);
  return { gauges, radiusMiles: RIVER_RADIUS_MILES };
}

const categories: Record<string, RiverCategory> = {
  no_flooding: "below",
  action: "action",
  minor: "minor",
  moderate: "moderate",
  major: "major",
};

export async function riverConditions(
  id: string,
  ctx: ExecutionContext,
): Promise<RiverConditions> {
  const [metadata, forecastResult] = await Promise.allSettled([
    cachedNoaa(`/gauges/${id}`, 120, ctx, (raw) => {
      if (text(raw.lid).toUpperCase() !== id || !text(raw.name))
        throw new UpstreamError("NOAA did not return this gauge.");
      const observed = object(object(raw.status).observed);
      const flood = object(raw.flood);
      const thresholds: RiverConditions["thresholds"] = [];
      for (const category of [
        "action",
        "minor",
        "moderate",
        "major",
      ] as const) {
        const threshold = object(object(flood.categories)[category]);
        for (const [key, units] of [
          ["stage", flood.stageUnits],
          ["flow", flood.flowUnits],
        ] as const) {
          const number = value(threshold[key]);
          const label = unit(units);
          if (number !== null && label)
            thresholds.push({ category, value: number, unit: label });
        }
      }
      return {
        id,
        name: text(raw.name),
        inService: object(raw.inService).enabled !== false,
        observed: reading(observed, observed.primaryUnit),
        observedCategory: Object.hasOwn(
          categories,
          text(observed.floodCategory),
        )
          ? categories[text(observed.floodCategory)]
          : "unknown",
        observationNotCurrent:
          text(observed.floodCategory) === "obs_not_current",
        forecastNotCurrent:
          text(object(object(raw.status).forecast).floodCategory) ===
          "fcst_not_current",
        thresholds,
      };
    }),
    // This is NWPS's official forecast product, never National Water Model output.
    cachedNoaa(`/gauges/${id}/stageflow/forecast`, 120, ctx, (raw) => {
      if (!Array.isArray(raw.data))
        throw new UpstreamError("NOAA did not return a forecast product.");
      return {
        issuedAt: timestamp(raw.issuedTime),
        readings: raw.data.flatMap((input: unknown) => {
          const datum = reading(input, raw.primaryUnits);
          return datum ? [datum] : [];
        }),
      };
    }),
  ]);
  if (metadata.status === "rejected") throw metadata.reason;
  const { forecastNotCurrent, ...gauge } = metadata.value;
  const forecast: RiverConditions["forecast"] =
    forecastResult.status === "fulfilled"
      ? {
          ...forecastResult.value,
          state:
            forecastResult.value.issuedAt &&
            forecastResult.value.readings.length
              ? "issued"
              : "not-issued",
          notCurrent: forecastNotCurrent,
        }
      : {
          state: "unavailable",
          issuedAt: null,
          readings: [],
          notCurrent: false,
        };
  return { ...gauge, forecast, checkedAt: new Date().toISOString() };
}
