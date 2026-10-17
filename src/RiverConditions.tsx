import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronDown, LoaderCircle } from "lucide-react";
import {
  categoryLabel,
  forecastStateLabel,
  forecastSummary,
  observationState,
  readingLabel,
  type NearbyRivers,
  type RiverConditions as Conditions,
} from "./rivers";

const REFRESH_INTERVAL = 5 * 60 * 1000;
const dateLabel = (date: string) =>
  new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

async function getNoaa<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, cache: "no-store" });
  if (!response.ok)
    throw new Error("NOAA river conditions could not be loaded.");
  return (await response.json()) as T;
}

export default function RiverConditions({
  lng,
  lat,
}: {
  lng: number;
  lat: number;
}) {
  const [nearby, setNearby] = useState<NearbyRivers | null>(null);
  const [gaugeId, setGaugeId] = useState("");
  const [data, setData] = useState<Conditions | null>(null);
  const [discoveryError, setDiscoveryError] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [discovering, setDiscovering] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    let lastRefresh = Date.now();
    const update = () => {
      const time = Date.now();
      setNow(time);
      if (
        document.visibilityState === "visible" &&
        time - lastRefresh >= REFRESH_INTERVAL
      ) {
        lastRefresh = time;
        setRefresh((value) => value + 1);
      }
    };
    const timer = window.setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setDiscovering(true);
    setDiscoveryError(false);
    void getNoaa<NearbyRivers>(
      `/api/rivers?lng=${lng.toFixed(7)}&lat=${lat.toFixed(7)}`,
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setNearby(result);
        setGaugeId((previous) =>
          result.gauges.some((gauge) => gauge.id === previous)
            ? previous
            : result.gauges[0]?.id || "",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setDiscoveryError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDiscovering(false);
      });
    return () => controller.abort();
  }, [lng, lat, refresh]);

  useEffect(() => {
    if (!gaugeId) return;
    const controller = new AbortController();
    setLoading(true);
    setDetailError(false);
    // Never leave another station's reading beneath the new station's name.
    setData((previous) => (previous?.id === gaugeId ? previous : null));
    void getNoaa<Conditions>(`/api/rivers/${gaugeId}`, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setNow(Date.now());
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setData(null);
          setDetailError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [gaugeId, refresh]);

  const gauge = nearby?.gauges.find((item) => item.id === gaugeId);
  const current = data?.id === gaugeId ? data : null;
  const observed = current?.observed;
  const observation = current ? observationState(current, now) : "unavailable";
  const forecast = current ? forecastSummary(current, now) : null;
  const preferredUnit =
    observed?.unit ??
    (forecast?.state === "available" ? forecast.peak.unit : undefined);
  const floodStage = current?.thresholds.find(
    (item) =>
      item.category === "minor" &&
      (!preferredUnit || item.unit === preferredUnit),
  );
  const observedAlert =
    observation === "current" &&
    current &&
    ["action", "minor", "moderate", "major"].includes(current.observedCategory);
  const forecastAlert =
    forecast?.state === "available" &&
    ["action", "minor", "moderate", "major"].includes(forecast.category);
  const error = discoveryError || detailError;
  const busy = discovering || loading;
  const retry = () => setRefresh((value) => value + 1);
  let preview = "Checking nearby NOAA gauges…";
  if (error) preview = "NOAA data unavailable · open to retry";
  else if (nearby && !nearby.gauges.length)
    preview = `No NOAA gauges within ${nearby.radiusMiles} miles`;
  else if (current && !current.inService)
    preview = "This gauge is out of service";
  else if (current)
    preview = observed
      ? `${readingLabel(observed)} · ${observation === "current" ? "Observed" : "Out of date"} ${dateLabel(observed.validAt)}`
      : "Latest reading unavailable";

  return (
    <details className="river-conditions">
      <summary>
        <span>
          <strong>River conditions nearby</strong>
          <span className="river-preview">
            {gauge && (
              <span>
                {gauge.name} · {gauge.distanceMiles.toFixed(1)} mi
              </span>
            )}
            <span>
              {busy && !current ? (
                <LoaderCircle size={13} className="spin" />
              ) : null}
              {preview}
            </span>
            {observedAlert && !error && (
              <span className="river-caution">
                {categoryLabel(current.observedCategory)}
              </span>
            )}
            {forecast && !error && current?.inService && (
              <span>
                {forecast.state === "available"
                  ? `Forecast high: ${readingLabel(forecast.peak)}`
                  : forecastStateLabel(forecast.state)}
                {forecastAlert && forecast.state === "available" && (
                  <span className="river-caution">
                    {" "}
                    · {categoryLabel(forecast.category)}
                  </span>
                )}
              </span>
            )}
          </span>
        </span>
        <ChevronDown size={16} />
      </summary>
      <div className="river-body" aria-live="polite">
        {nearby && nearby.gauges.length > 0 && (
          <>
            <label htmlFor="river-gauge">Nearby gauge</label>
            <select
              id="river-gauge"
              value={gaugeId}
              onChange={(event) => {
                setData(null);
                setDetailError(false);
                setGaugeId(event.target.value);
              }}
            >
              {nearby.gauges.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name} · {station.distanceMiles.toFixed(1)} mi
                </option>
              ))}
            </select>
            <p className="small muted">
              {gauge?.distanceMiles.toFixed(1)} miles from your point,
              straight-line distance. The nearest gauge may be on a different
              river.
            </p>
          </>
        )}
        {busy && (
          <p className="river-loading">
            <LoaderCircle size={14} className="spin" />
            Updating NOAA…
          </p>
        )}
        {error && (
          <p role="status">
            NOAA river conditions are unavailable. Your FEMA result is separate.
          </p>
        )}
        {!gauge && !busy && !error && (
          <p>
            No NOAA gauges were found within {nearby?.radiusMiles} miles. This
            does not indicate low flood risk.
          </p>
        )}
        {current && !error && (
          <>
            {!current.inService ? (
              <p>This gauge is out of service. Choose another nearby gauge.</p>
            ) : (
              <dl className="river-facts">
                <div>
                  <dt>Latest reading</dt>
                  <dd>
                    {observed ? (
                      <>
                        <strong>{readingLabel(observed)}</strong>
                        <time dateTime={observed.validAt}>
                          {dateLabel(observed.validAt)}
                        </time>
                      </>
                    ) : (
                      "Not available"
                    )}
                    {observation === "stale" ? (
                      <span className="river-caution">
                        Reading is out of date
                      </span>
                    ) : (
                      observed && (
                        <span
                          className={
                            current.observedCategory === "minor" ||
                            current.observedCategory === "moderate" ||
                            current.observedCategory === "major"
                              ? "river-caution"
                              : "muted"
                          }
                        >
                          {categoryLabel(current.observedCategory)}
                        </span>
                      )
                    )}
                  </dd>
                </div>
                {floodStage && (
                  <div>
                    <dt>
                      {["ft", "m", "feet", "meters"].includes(floodStage.unit)
                        ? "Flood stage"
                        : "Flood threshold"}
                    </dt>
                    <dd>
                      {readingLabel({ ...floodStage, validAt: "" })}
                      <span className="muted">
                        Minor flooding begins at this gauge
                      </span>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Forecast high</dt>
                  <dd>
                    {forecast?.state === "available" ? (
                      <>
                        <strong>{readingLabel(forecast.peak)}</strong>
                        <time dateTime={forecast.peak.validAt}>
                          {dateLabel(forecast.peak.validAt)}
                        </time>
                        <span
                          className={
                            forecast.category === "minor" ||
                            forecast.category === "moderate" ||
                            forecast.category === "major"
                              ? "river-caution"
                              : "muted"
                          }
                        >
                          {categoryLabel(forecast.category)}
                        </span>
                        <span className="muted">
                          Highest remaining forecast through{" "}
                          {dateLabel(forecast.through)}
                        </span>
                        <span className="muted">
                          Issued {dateLabel(current.forecast.issuedAt!)}
                        </span>
                      </>
                    ) : (
                      forecast && forecastStateLabel(forecast.state)
                    )}
                  </dd>
                </div>
              </dl>
            )}
            <p className="small muted river-note">
              Levels use this gauge’s reference, not water depth at your house.
              Nearby rivers can behave differently; this is not a forecast for
              your property.
            </p>
          </>
        )}
        {gauge && (
          <a
            className="river-source"
            href={`https://water.noaa.gov/gauges/${gauge.id.toLowerCase()}`}
            target="_blank"
            rel="noreferrer"
          >
            Official NOAA gauge &amp; forecast <ArrowUpRight size={16} />
          </a>
        )}
        <button
          className="text-button river-refresh"
          onClick={retry}
          disabled={busy}
        >
          {error ? "Retry NOAA" : "Refresh river conditions"}
        </button>
        <p className="small muted river-update-note">
          NOAA / National Weather Service · refreshes every 5 minutes while this
          tab is visible.
        </p>
      </div>
    </details>
  );
}
