export const RIVER_RADIUS_MILES = 25;
export const OBSERVATION_MAX_AGE = 6 * 60 * 60 * 1000;
export const FORECAST_MAX_AGE = 48 * 60 * 60 * 1000;
const CLOCK_TOLERANCE = 15 * 60 * 1000;

export type RiverCategory =
  "below" | "action" | "minor" | "moderate" | "major" | "unknown";
export type RiverReading = { value: number; unit: string; validAt: string };
export type NearbyRiver = { id: string; name: string; distanceMiles: number };
export type NearbyRivers = { gauges: NearbyRiver[]; radiusMiles: number };
export type RiverConditions = {
  id: string;
  name: string;
  inService: boolean;
  observed: RiverReading | null;
  observedCategory: RiverCategory;
  observationNotCurrent: boolean;
  thresholds: {
    category: Exclude<RiverCategory, "below" | "unknown">;
    value: number;
    unit: string;
  }[];
  forecast: {
    state: "issued" | "not-issued" | "unavailable";
    issuedAt: string | null;
    notCurrent: boolean;
    readings: RiverReading[];
  };
  checkedAt: string;
};

export function observationState(data: RiverConditions, now: number) {
  if (!data.inService || !data.observed) return "unavailable";
  const age = now - Date.parse(data.observed.validAt);
  return data.observationNotCurrent ||
    !Number.isFinite(age) ||
    age > OBSERVATION_MAX_AGE ||
    age < -CLOCK_TOLERANCE
    ? "stale"
    : "current";
}

export function forecastSummary(data: RiverConditions, now: number) {
  const forecast = data.forecast;
  if (!data.inService || forecast.state === "unavailable")
    return { state: "unavailable" as const };
  if (forecast.state === "not-issued") return { state: "not-issued" as const };
  const age = now - Date.parse(forecast.issuedAt || "");
  if (
    forecast.notCurrent ||
    !Number.isFinite(age) ||
    age > FORECAST_MAX_AGE ||
    age < -CLOCK_TOLERANCE
  )
    return { state: "stale" as const };
  // Recompute as time passes: a past crest must not become an upcoming high.
  const future = forecast.readings.filter(
    (reading) => Date.parse(reading.validAt) >= now,
  );
  if (!future.length) return { state: "expired" as const };
  const peak = future.reduce((highest, reading) =>
    reading.value > highest.value ? reading : highest,
  );
  const through = future.reduce((latest, reading) =>
    Date.parse(reading.validAt) > Date.parse(latest.validAt) ? reading : latest,
  ).validAt;
  const threshold = [...data.thresholds]
    .filter((item) => item.unit === peak.unit && peak.value >= item.value)
    .sort((a, b) => b.value - a.value)[0];
  const hasFloodStage = data.thresholds.some(
    (item) => item.category === "minor" && item.unit === peak.unit,
  );
  return {
    state: "available" as const,
    peak,
    through,
    category:
      threshold?.category ??
      ((hasFloodStage ? "below" : "unknown") as RiverCategory),
  };
}

export const categoryLabel = (category: RiverCategory) =>
  ({
    below: "Below flood stage at this gauge",
    action: "Action stage at this gauge",
    minor: "Minor flooding at this gauge",
    moderate: "Moderate flooding at this gauge",
    major: "Major flooding at this gauge",
    unknown: "Flood category not available",
  })[category];

export function readingLabel(reading: RiverReading) {
  return `${reading.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${reading.unit}`;
}

export const forecastStateLabel = (
  state: ReturnType<typeof forecastSummary>["state"],
) =>
  ({
    available: "Official NOAA forecast",
    "not-issued": "No active NOAA forecast",
    unavailable: "NOAA forecast unavailable",
    stale: "NOAA forecast is out of date",
    expired: "NOAA forecast has ended",
  })[state];
