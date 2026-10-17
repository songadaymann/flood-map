import {
  publishedFloodMeasures,
  summarizeZones,
  type FloodResponse,
} from "./flood";

const dateLabel = (date: number) =>
  new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export default function PointDetails({ data }: { data: FloodResponse }) {
  const measures = publishedFloodMeasures(data.zones);
  const panels = data.panels.filter(
    (panel) =>
      typeof panel.EFF_DATE === "number" &&
      Number.isFinite(panel.EFF_DATE) &&
      panel.EFF_DATE > 0,
  );
  const floodway = data.zones.some((zone) =>
    /FLOODWAY/.test(zone.ZONE_SUBTY || ""),
  );
  const hasElevation = measures.some((measure) => measure.kind === "elevation");
  const hasDepth = measures.some((measure) => measure.kind === "depth");
  return (
    <div className="point-details">
      <dl className="point-facts" aria-label="Additional FEMA information">
        {panels.map((panel, index) => (
          <div key={`${panel.FIRM_PAN}-${index}`}>
            <dt>Map effective</dt>
            <dd>
              <time
                dateTime={new Date(panel.EFF_DATE!).toISOString().slice(0, 10)}
              >
                {dateLabel(panel.EFF_DATE!)}
              </time>
              {panels.length > 1 && (
                <span className="small muted"> · {panel.FIRM_PAN}</span>
              )}
            </dd>
          </div>
        ))}
        {!panels.length && (
          <div>
            <dt>Map effective</dt>
            <dd>
              {data.panelStatus === "unavailable"
                ? "Temporarily unavailable"
                : "Date not supplied"}
            </dd>
          </div>
        )}
        {data.zones.length > 0 && (
          <div>
            <dt>Floodway</dt>
            <dd>
              {floodway
                ? "Mapped floodway"
                : "No floodway flagged in the returned zones"}
            </dd>
          </div>
        )}
        {measures.map((measure, index) => (
          <div key={`${measure.kind}-${index}`}>
            <dt>
              {measure.kind === "elevation"
                ? "Base flood elevation"
                : "Average flood depth"}
            </dt>
            <dd>
              {measure.value.toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })}
              {measure.unit ? ` ${measure.unit}` : " (unit not supplied)"}
              {measure.kind === "elevation" &&
                (measure.datum
                  ? ` · ${measure.datum}`
                  : " · reference not supplied")}
              {data.zones.length > 1 && (
                <span className="small muted"> · Zone {measure.zone}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {floodway && (
        <p className="small muted fact-note">
          FEMA designates the channel and adjoining land that carry the base
          flood as a floodway.
        </p>
      )}
      {hasElevation && (
        <p className="small muted fact-note">
          Flood elevation uses a reference level, such as NAVD 88. Comparing it
          with a house requires a surveyed building elevation using the same
          reference.
        </p>
      )}
      {hasDepth && (
        <p className="small muted fact-note">
          Depth is FEMA’s average for the mapped area, rather than a prediction
          for an individual building.
        </p>
      )}
      {!measures.length && summarizeZones(data.zones).kind === "high" && (
        <p className="small muted fact-note">
          No flood elevation or depth is supplied in these zone attributes. The
          official FEMA map may include more study details.
        </p>
      )}
    </div>
  );
}
