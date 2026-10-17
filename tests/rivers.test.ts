import { test } from "node:test";
import assert from "node:assert/strict";
import {
  forecastSummary,
  observationState,
  type RiverConditions,
} from "../src/rivers";
import { distanceMiles, gaugeSearchBounds } from "../worker/rivers";

const now = Date.parse("2026-10-16T20:00:00Z");
const station = (): RiverConditions => ({
  id: "HFDC3",
  name: "Connecticut River at Hartford",
  inService: true,
  observed: { value: 0, unit: "ft", validAt: "2026-10-16T19:45:00Z" },
  observedCategory: "below",
  observationNotCurrent: false,
  thresholds: [
    { category: "minor", value: 16, unit: "ft" },
    { category: "moderate", value: 20, unit: "ft" },
  ],
  forecast: {
    state: "issued",
    issuedAt: "2026-10-16T18:00:00Z",
    notCurrent: false,
    readings: [
      { value: 30, unit: "ft", validAt: "2026-10-16T19:00:00Z" },
      { value: 21, unit: "ft", validAt: "2026-10-17T00:00:00Z" },
      { value: 12, unit: "ft", validAt: "2026-10-18T00:00:00Z" },
    ],
  },
  checkedAt: "2026-10-16T20:00:00Z",
});

test("Zero readings are current; old or NOAA-flagged readings are never current", () => {
  const data = station();
  assert.equal(observationState(data, now), "current");
  data.observed!.validAt = "2026-10-16T12:00:00Z";
  assert.equal(observationState(data, now), "stale");
  data.observed!.validAt = "2026-10-16T19:45:00Z";
  data.observationNotCurrent = true;
  assert.equal(observationState(data, now), "stale");
  data.observed = null;
  assert.equal(observationState(data, now), "unavailable");
});

test("Forecast high excludes past crests and advances with time", () => {
  const data = station();
  const result = forecastSummary(data, now);
  assert.equal(result.state, "available");
  if (result.state !== "available") return;
  assert.equal(result.peak.value, 21);
  assert.equal(result.category, "moderate");
  assert.equal(result.through, "2026-10-18T00:00:00Z");
  const later = forecastSummary(data, Date.parse("2026-10-17T12:00:00Z"));
  assert.equal(later.state, "available");
  if (later.state === "available") assert.equal(later.peak.value, 12);
});

test("Missing, expired, stale and out-of-service forecasts stay distinct", () => {
  const data = station();
  data.forecast.state = "not-issued";
  assert.equal(forecastSummary(data, now).state, "not-issued");
  data.forecast.state = "unavailable";
  assert.equal(forecastSummary(data, now).state, "unavailable");
  data.forecast.state = "issued";
  data.forecast.notCurrent = true;
  assert.equal(forecastSummary(data, now).state, "stale");
  data.forecast.notCurrent = false;
  data.forecast.issuedAt = "2026-10-13T18:00:00Z";
  assert.equal(forecastSummary(data, now).state, "stale");
  data.forecast.issuedAt = "2026-10-16T18:00:00Z";
  data.forecast.readings = [];
  assert.equal(forecastSummary(data, now).state, "expired");
  data.inService = false;
  assert.equal(forecastSummary(data, now).state, "unavailable");
  assert.equal(observationState(data, now), "unavailable");
});

test("Unknown thresholds or different units never imply a below-flood-stage forecast", () => {
  const data = station();
  data.thresholds = [{ category: "minor", value: 3, unit: "m" }];
  const result = forecastSummary(data, now);
  assert.equal(result.state === "available" && result.category, "unknown");
  data.thresholds = [];
  const missing = forecastSummary(data, now);
  assert.equal(missing.state === "available" && missing.category, "unknown");
});

test("Future-dated observations and forecast issuances are not presented as fresh", () => {
  const data = station();
  data.observed!.validAt = "2026-10-17T19:45:00Z";
  data.forecast.issuedAt = "2026-10-17T18:00:00Z";
  assert.equal(observationState(data, now), "stale");
  assert.equal(forecastSummary(data, now).state, "stale");
});

test("Gauge discovery bounds include the search point and handle the date line", () => {
  assert.equal(distanceMiles(-72.74, 41.76, -72.74, 41.76), 0);
  assert.ok(distanceMiles(-72.74, 41.76, -72.66755, 41.769094) < 5);
  for (const [lng, lat] of [
    [-72.74, 41.76],
    [-179.99, 60],
    [179.99, -60],
    [0, 85.05],
  ]) {
    const boxes = gaugeSearchBounds(lng, lat);
    assert.ok(
      boxes.some(
        (box) =>
          lng >= box.xmin &&
          lng <= box.xmax &&
          lat >= box.ymin &&
          lat <= box.ymax,
      ),
    );
    for (const box of boxes) {
      assert.ok(box.xmin >= -180 && box.xmax <= 180 && box.xmin < box.xmax);
      assert.ok(box.ymin >= -90 && box.ymax <= 90 && box.ymin < box.ymax);
    }
  }
  assert.equal(gaugeSearchBounds(179.99, 60).length, 2);
});
