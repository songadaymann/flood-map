import test from "node:test";
import assert from "node:assert/strict";
import { classifyZone, summarizeZones, readPoint } from "../src/flood";
import { tileBounds, tileExportUrl } from "../worker/tiles";

test("Zone X requires its FEMA subtype before reporting minimal hazard", () => {
  assert.equal(
    classifyZone({ FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" })
      .kind,
    "minimal",
  );
  assert.equal(
    classifyZone({
      FLD_ZONE: "X",
      ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD",
    }).kind,
    "moderate",
  );
  assert.equal(
    classifyZone({ FLD_ZONE: "X", ZONE_SUBTY: "1 PCT DEPTH LESS THAN 1 FOOT" })
      .kind,
    "special",
  );
  assert.equal(
    classifyZone({
      FLD_ZONE: "X",
      ZONE_SUBTY: "AREA WITH REDUCED FLOOD RISK DUE TO LEVEE",
    }).kind,
    "special",
  );
  assert.equal(classifyZone({ FLD_ZONE: "X" }).kind, "special");
});
test("No coverage, unknown zones, and unmapped areas never imply low hazard", () => {
  assert.equal(summarizeZones([]).kind, "unknown");
  assert.match(summarizeZones([]).explanation, /not evidence of low risk/);
  for (const FLD_ZONE of ["D", "", "AREA NOT INCLUDED", "OPEN WATER"])
    assert.equal(classifyZone({ FLD_ZONE }).kind, "unknown");
  assert.equal(
    classifyZone({
      FLD_ZONE: "X",
      ZONE_SUBTY: "AREA WITH UNDETERMINED FLOOD HAZARD",
    }).kind,
    "unknown",
  );
});
test("Coastal, riverine, and legacy high-hazard zones preserve their designations", () => {
  for (const FLD_ZONE of [
    "A",
    "AE",
    "AH",
    "AO",
    "A99",
    "AR",
    "AR/AE",
    "A12",
    "V",
    "VE",
    "V2",
  ])
    assert.equal(classifyZone({ FLD_ZONE }).kind, "high", FLD_ZONE);
  assert.match(classifyZone({ FLD_ZONE: "VE" }).explanation, /wave hazards/);
});
test("A FEMA SFHA flag is treated conservatively even when zone attributes conflict", () => {
  assert.equal(
    classifyZone({
      FLD_ZONE: "X",
      ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD",
      SFHA_TF: "T",
    }).kind,
    "high",
  );
});
test("Overlapping polygons use the more cautious result, independently of server ordering", () => {
  const minimal = { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" };
  const high = { FLD_ZONE: "AE" };
  assert.equal(summarizeZones([minimal, high]).kind, "high");
  assert.equal(summarizeZones([high, minimal]).kind, "high");
  assert.equal(summarizeZones([minimal, { FLD_ZONE: "D" }]).kind, "unknown");
});
test("Zone B does not claim that every subtype has precisely a 0.2% annual chance", () => {
  assert.match(
    classifyZone({ FLD_ZONE: "B" }).explanation,
    /other moderate-hazard/,
  );
});
test("Reject missing, empty, infinite, out-of-range, and malformed coordinates", () => {
  for (const query of [
    "",
    "lat=&lng=",
    "lat=NaN&lng=12",
    "lat=91&lng=0",
    "lat=40&lng=181",
    "lat=40&lng=Infinity",
  ])
    assert.equal(readPoint(new URLSearchParams(query)), null);
  assert.deepEqual(readPoint(new URLSearchParams("lat=0&lng=0")), {
    lat: 0,
    lng: 0,
  });
});
test("FEMA tile bounding boxes align exactly between neighboring tiles", () => {
  const left = tileBounds(13, 2440, 3047);
  const right = tileBounds(13, 2441, 3047);
  const below = tileBounds(13, 2440, 3048);
  assert.equal(left[2], right[0]);
  assert.equal(left[1], below[3]);
  const url = new URL(tileExportUrl(13, 2440, 3047));
  assert.equal(url.hostname, "hazards.fema.gov");
  assert.equal(url.searchParams.get("transparent"), "true");
  const layers = JSON.parse(url.searchParams.get("dynamicLayers")!);
  assert.equal(layers.length, 4);
  assert.ok(
    layers.every(
      (layer: { source: { mapLayerId: number } }) =>
        layer.source.mapLayerId === 28,
    ),
  );
});
