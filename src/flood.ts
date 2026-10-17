export const FEMA_SERVICE =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
export const IMAGERY_SERVICE =
  "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer";
export const IMAGERY_OVERVIEW_TILES =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";
export type Basemap = "map" | "satellite";
export function readBasemap(params: URLSearchParams): Basemap {
  return params.get("view") === "satellite" ? "satellite" : "map";
}
export const SOURCE_REPO = "https://github.com/songadaymann/flood-map";
export const DEFAULT_VIEW = { lng: -72.746, lat: 41.762, zoom: 12.8 };

export interface ZoneAttributes {
  FLD_ZONE?: string | null;
  ZONE_SUBTY?: string | null;
  SFHA_TF?: string | null;
  DFIRM_ID?: string | null;
  STATIC_BFE?: number | null;
  V_DATUM?: string | null;
  LEN_UNIT?: string | null;
  DEPTH?: number | null;
  STUDY_TYP?: string | null;
}
export interface PanelAttributes {
  FIRM_PAN?: string | null;
  EFF_DATE?: number | null;
}
export interface FloodResponse {
  zones: ZoneAttributes[];
  panels: PanelAttributes[];
  panelStatus: "available" | "unavailable";
  checkedAt: string;
}
export interface AddressMatch {
  label: string;
  lng: number;
  lat: number;
}
export type HazardKind =
  "high" | "moderate" | "minimal" | "special" | "unknown";
export interface ZoneSummary {
  kind: HazardKind;
  title: string;
  explanation: string;
  zone: string;
}

export function classifyZone(attributes: ZoneAttributes): ZoneSummary {
  const zone = attributes.FLD_ZONE?.trim().toUpperCase() || "";
  const subtype = attributes.ZONE_SUBTY?.trim().toUpperCase() || "";
  if (
    /^(A|AE|AH|AO|AR|A\d{1,2}|V|VE|V\d{1,2})(\/A.*)?$/.test(zone) ||
    attributes.SFHA_TF?.toUpperCase() === "T"
  ) {
    const coastal = zone.startsWith("V");
    return {
      kind: "high",
      zone,
      title: coastal ? "High flood hazard · coastal" : "High flood hazard",
      explanation: coastal
        ? "FEMA maps this point in a coastal high-hazard zone, with a 1% or greater annual chance of flooding and additional wave hazards."
        : "FEMA maps this point in a Special Flood Hazard Area, with a 1% or greater chance of flooding in any given year.",
    };
  }
  if (
    zone === "D" ||
    /UNDETERMINED|NOT INCLUDED|NOT MAPPED|OPEN WATER/.test(subtype)
  ) {
    return {
      kind: "unknown",
      zone,
      title: "Flood hazard undetermined",
      explanation:
        "FEMA has not determined the flood hazard at this point. This does not mean low risk.",
    };
  }
  if (zone === "B" || (zone === "X" && /0\.2/.test(subtype))) {
    return {
      kind: "moderate",
      zone,
      title: "Moderate flood hazard",
      explanation:
        zone === "B"
          ? "FEMA maps this point in Zone B, which can include the 0.2% annual-chance flood area or other moderate-hazard conditions."
          : "FEMA maps this point in the 0.2% annual-chance flood area, outside the mapped 1% annual-chance flood area.",
    };
  }
  if (
    zone === "C" ||
    (zone === "X" && subtype === "AREA OF MINIMAL FLOOD HAZARD")
  ) {
    return {
      kind: "minimal",
      zone,
      title: "Minimal mapped flood hazard",
      explanation:
        "FEMA maps this point outside the 0.2% annual-chance flood area. Flooding can still happen here.",
    };
  }
  if (zone === "X") {
    return {
      kind: "special",
      zone,
      title: "Other mapped flood area",
      explanation: /LEVEE/.test(subtype)
        ? "FEMA identifies levee-related conditions here. Zone X alone does not describe the level of flood protection or the remaining risk."
        : "FEMA identifies a Zone X area with additional conditions. Check the map details before interpreting its flood hazard.",
    };
  }
  return {
    kind: "unknown",
    zone,
    title: "Flood hazard undetermined",
    explanation:
      "This FEMA designation does not provide a clear flood-hazard category. Check the official FEMA map.",
  };
}

export function summarizeZones(zones: ZoneAttributes[]): ZoneSummary {
  if (!zones.length)
    return {
      kind: "unknown",
      zone: "",
      title: "No FEMA zone returned",
      explanation:
        "FEMA did not return a flood-zone polygon at this point. Digital coverage may be missing. This is not evidence of low risk.",
    };
  const priority: Record<HazardKind, number> = {
    high: 5,
    unknown: 4,
    special: 3,
    moderate: 2,
    minimal: 1,
  };
  return zones
    .map(classifyZone)
    .sort((a, b) => priority[b.kind] - priority[a.kind])[0];
}

export function readPoint(
  params: URLSearchParams,
): { lng: number; lat: number } | null {
  const lngValue = params.get("lng");
  const latValue = params.get("lat");
  if (!lngValue?.trim() || !latValue?.trim()) return null;
  const lng = Number(lngValue);
  const lat = Number(latValue);
  return Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 85.051129
    ? { lng, lat }
    : null;
}

export function officialMapUrl(lng: number, lat: number): string {
  return `https://msc.fema.gov/portal/search?AddressQuery=${encodeURIComponent(`${lat.toFixed(6)}, ${lng.toFixed(6)}`)}`;
}

export function formatSubtype(value: string | null | undefined): string {
  if (!value || value === " " || value === "<Null>")
    return "No additional subtype supplied";
  return value
    .toLowerCase()
    .replace(/\b(pct|percent)\b/g, "%")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export interface FloodMeasure {
  kind: "elevation" | "depth";
  value: number;
  unit: "ft" | "m" | null;
  datum: string | null;
  zone: string;
}

export function publishedFloodMeasures(
  zones: ZoneAttributes[],
): FloodMeasure[] {
  const measures: FloodMeasure[] = [];
  const valid = (value: unknown): value is number =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > -9999 &&
    value !== -8888;
  for (const zone of zones) {
    const rawUnit = zone.LEN_UNIT?.trim().toUpperCase();
    const unit = ["FT", "FEET", "FOOT"].includes(rawUnit || "")
      ? "ft"
      : ["M", "METERS", "METRES", "METER", "METRE"].includes(rawUnit || "")
        ? "m"
        : null;
    const rawDatum = zone.V_DATUM?.trim();
    const datum =
      !rawDatum || rawDatum === "<Null>"
        ? null
        : rawDatum
            .replace(/^NAVD\s*88$/i, "NAVD 88")
            .replace(/^NGVD\s*29$/i, "NGVD 29");
    if (valid(zone.STATIC_BFE))
      measures.push({
        kind: "elevation",
        value: zone.STATIC_BFE,
        unit,
        datum,
        zone: zone.FLD_ZONE || "Unspecified",
      });
    if (valid(zone.DEPTH) && zone.DEPTH > 0)
      measures.push({
        kind: "depth",
        value: zone.DEPTH,
        unit,
        datum: null,
        zone: zone.FLD_ZONE || "Unspecified",
      });
  }
  return measures.filter(
    (measure, index, all) =>
      all.findIndex(
        (other) =>
          other.kind === measure.kind &&
          other.value === measure.value &&
          other.unit === measure.unit &&
          other.datum === measure.datum,
      ) === index,
  );
}
