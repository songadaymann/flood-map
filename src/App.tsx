import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Crosshair,
  ExternalLink,
  Info,
  Layers,
  Link,
  LoaderCircle,
  MapPin,
  Search,
  X,
} from "lucide-react";
import {
  MapView,
  initialPoint,
  type MapHandle,
  type OverlayStatus,
  type Selection,
} from "./MapView";
import {
  SOURCE_REPO,
  formatSubtype,
  officialMapUrl,
  summarizeZones,
  type AddressMatch,
  type FloodResponse,
} from "./flood";

async function api<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  const json: unknown = await response.json();
  if (!response.ok) {
    const message =
      json &&
      typeof json === "object" &&
      "error" in json &&
      typeof json.error === "string"
        ? json.error
        : "The lookup could not be completed. Please try again.";
    throw new Error(message);
  }
  return json as T;
}
const formatDate = (date: number | string) =>
  new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
function addressCase(address: string) {
  return address
    .split(", ")
    .map((part, index) =>
      index < 2
        ? part.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
        : part,
    )
    .join(", ");
}

export default function App() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<AddressMatch[]>([]);
  const [searchError, setSearchError] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [data, setData] = useState<FloodResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [overlay, setOverlay] = useState(true);
  const [overlayStatus, setOverlayStatus] = useState<OverlayStatus>("loading");
  const [mapError, setMapError] = useState("");
  const [locating, setLocating] = useState(false);
  const [about, setAbout] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState(false);
  const map = useRef<MapHandle>(null);
  const searchController = useRef<AbortController | null>(null);
  const floodController = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const locationRequest = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const summary = data ? summarizeZones(data.zones) : null;

  async function selectPoint(point: Selection) {
    locationRequest.current++;
    setLocating(false);
    searchController.current?.abort();
    setSearching(false);
    setMatches([]);
    setSearchError("");
    floodController.current?.abort();
    const controller = new AbortController();
    floodController.current = controller;
    const id = ++requestId.current;
    setSelection(point);
    setData(null);
    setLookupError("");
    setLoading(true);
    setCopied(false);
    setShareError(false);
    try {
      const result = await api<FloodResponse>(
        `/api/flood?lng=${point.lng.toFixed(7)}&lat=${point.lat.toFixed(7)}`,
        controller.signal,
      );
      if (id === requestId.current) setData(result);
    } catch (error) {
      if (!controller.signal.aborted && id === requestId.current)
        setLookupError(
          error instanceof Error
            ? error.message
            : "FEMA could not be reached. Please try again.",
        );
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (initialPoint)
      void selectPoint({
        ...initialPoint,
        label: "Shared location",
        approximate: false,
        fly: false,
      });
    return () => {
      searchController.current?.abort();
      floodController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (about) dialog.current?.showModal();
    else dialog.current?.close();
  }, [about]);

  async function search(event: FormEvent) {
    event.preventDefault();
    const address = query.trim();
    if (address.length < 3) {
      setSearchError("Enter a street address, city, and state.");
      return;
    }
    searchController.current?.abort();
    floodController.current?.abort();
    locationRequest.current++;
    requestId.current++;
    const controller = new AbortController();
    searchController.current = controller;
    setSearching(true);
    setLocating(false);
    setSelection(null);
    setData(null);
    setLoading(false);
    setLookupError("");
    setSearchError("");
    setMatches([]);
    try {
      const result = await api<{ matches: AddressMatch[] }>(
        `/api/search?q=${encodeURIComponent(address)}`,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!result.matches.length)
        setSearchError(
          "No address match. Include the house number, city, and state, or tap the map.",
        );
      else if (result.matches.length === 1)
        await selectPoint({
          ...result.matches[0],
          label: addressCase(result.matches[0].label),
          approximate: true,
          fly: true,
        });
      else setMatches(result.matches);
    } catch (error) {
      if (!controller.signal.aborted)
        setSearchError(
          error instanceof Error
            ? error.message
            : "Address search is unavailable. Try tapping the map.",
        );
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  function locate() {
    if (!navigator.geolocation) {
      setSearchError(
        "Location is not supported in this browser. Search an address instead.",
      );
      return;
    }
    const id = ++locationRequest.current;
    searchController.current?.abort();
    setSearching(false);
    setMatches([]);
    setSearchError("");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (id !== locationRequest.current) return;
        void selectPoint({
          lng: position.coords.longitude,
          lat: position.coords.latitude,
          label: "Your approximate location",
          approximate: true,
          fly: true,
        });
      },
      (error) => {
        if (id !== locationRequest.current) return;
        setLocating(false);
        setSearchError(
          error.code === 1
            ? "Location permission was not granted. Search an address or tap the map."
            : "Your location could not be found. Search an address or tap the map.",
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }

  async function share() {
    const url = map.current?.shareUrl() || window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setShareError(false);
    } catch {
      setShareError(true);
    }
  }

  return (
    <>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Flood Map home">
          <svg width="30" height="28" viewBox="0 0 30 28" aria-hidden="true">
            <path
              d="M1 9q7-8 14 0t14 0M1 19q7-8 14 0t14 0"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            />
          </svg>
          <span>
            Flood Map<span className="brand-dot">.</span>
          </span>
        </a>
        <button
          className="text-button about-button"
          onClick={() => setAbout(true)}
        >
          <Info size={17} />
          <span>About the data</span>
        </button>
      </header>
      <main className={`workspace ${selection ? "has-selection" : ""}`}>
        <aside className="sidebar">
          <section className="search-panel" aria-label="Find a flood zone">
            <h1>
              Know your <br />
              flood zone.
            </h1>
            <form onSubmit={search}>
              <label htmlFor="address">Find an address</label>
              <div className="search-field">
                <Search size={19} aria-hidden="true" />
                <input
                  id="address"
                  autoComplete="street-address"
                  placeholder="Street address, city, state"
                  value={query}
                  maxLength={100}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSearchError("");
                    setMatches([]);
                  }}
                />
                <button
                  type="submit"
                  className="search-submit"
                  aria-label="Search address"
                  disabled={searching}
                >
                  {searching ? (
                    <LoaderCircle size={21} className="spin" />
                  ) : (
                    <ArrowRight size={23} />
                  )}
                </button>
              </div>
            </form>
            <button
              className="text-button locate-button"
              onClick={locate}
              disabled={locating}
            >
              {locating ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Crosshair size={17} />
              )}
              {locating ? "Finding your location…" : "Use my location"}
            </button>
            {searchError && (
              <p role="alert" className="error-text">
                {searchError}
              </p>
            )}
            {matches.length > 1 && (
              <div className="address-matches">
                <p>Choose an address</p>
                <ul>
                  {matches.map((match) => (
                    <li key={`${match.lng},${match.lat}`}>
                      <button
                        onClick={() =>
                          void selectPoint({
                            ...match,
                            label: addressCase(match.label),
                            approximate: true,
                            fly: true,
                          })
                        }
                      >
                        {addressCase(match.label)}
                        <ArrowRight size={17} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section
            className="result-panel"
            aria-label="Flood zone result"
            aria-live="polite"
            aria-busy={loading}
          >
            {!selection && (
              <div className="empty-result">
                <MapPin size={24} strokeWidth={1.5} />
                <p>Or tap a point on the map.</p>
                <p className="small muted">
                  Starting in West Hartford, CT.
                  <br />
                  Look up any US street address.
                </p>
              </div>
            )}
            {selection && (
              <>
                <div className="selected-address">
                  <MapPin size={17} />
                  <div>
                    <h2>{selection.label}</h2>
                    <p className="small muted coordinates">
                      {selection.lat.toFixed(5)}, {selection.lng.toFixed(5)}
                    </p>
                  </div>
                </div>
                {loading && (
                  <p className="lookup-loading">
                    <LoaderCircle size={18} className="spin" />
                    Checking FEMA…
                  </p>
                )}
                {lookupError && (
                  <div className="lookup-error">
                    <h2>Flood zone unavailable</h2>
                    <p role="alert">{lookupError}</p>
                    <button
                      className="plain-button"
                      onClick={() =>
                        void selectPoint({ ...selection, fly: false })
                      }
                    >
                      Retry lookup <ArrowRight size={16} />
                    </button>
                  </div>
                )}
                {data && summary && (
                  <div className={`zone-result ${summary.kind}`}>
                    <div className="result-title">
                      <span className={`status-dot ${summary.kind}`} />
                      <h2>{summary.title}</h2>
                    </div>
                    {summary.zone && (
                      <p className="zone-code">Zone {summary.zone}</p>
                    )}
                    <p className="zone-explanation">{summary.explanation}</p>
                    {data.zones.some((zone) =>
                      /FLOODWAY/.test(zone.ZONE_SUBTY || ""),
                    ) && (
                      <p className="small emphasis">
                        This point is also in a mapped floodway.
                      </p>
                    )}
                    {data.zones.length > 1 && (
                      <p className="small emphasis">
                        {data.zones.length} FEMA polygons overlap here. The
                        result shows the more cautious category; review each
                        designation below.
                      </p>
                    )}
                    {selection.approximate && (
                      <p className="small muted approximation">
                        Location is approximate. Tap your building to refine the
                        point.
                      </p>
                    )}
                    <details className="map-details">
                      <summary>
                        FEMA map details <ChevronDown size={16} />
                      </summary>
                      <dl>
                        {data.zones.map((zone, index) => (
                          <div key={index}>
                            <dt>
                              Designation{" "}
                              {data.zones.length > 1 ? index + 1 : ""}
                            </dt>
                            <dd>
                              {zone.FLD_ZONE || "Unspecified"} ·{" "}
                              {formatSubtype(zone.ZONE_SUBTY)}
                            </dd>
                          </div>
                        ))}
                        {data.panels.map((panel, index) => (
                          <div key={index}>
                            <dt>Map panel</dt>
                            <dd>
                              {panel.FIRM_PAN || "Not supplied"}
                              {typeof panel.EFF_DATE === "number" &&
                                panel.EFF_DATE > 0 && (
                                  <>
                                    <br />
                                    Effective {formatDate(panel.EFF_DATE)}
                                  </>
                                )}
                            </dd>
                          </div>
                        ))}
                        {!data.panels.length && (
                          <div>
                            <dt>Map panel</dt>
                            <dd>
                              {data.panelStatus === "unavailable"
                                ? "Panel service unavailable"
                                : "No panel returned"}
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt>Data checked</dt>
                          <dd>{formatDate(data.checkedAt)}</dd>
                        </div>
                      </dl>
                    </details>
                  </div>
                )}
                <div className="result-links">
                  <a
                    href={officialMapUrl(selection.lng, selection.lat)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Official FEMA map <ArrowUpRight size={17} />
                  </a>
                  <button className="text-button" onClick={() => void share()}>
                    {copied ? <Check size={16} /> : <Link size={16} />}
                    {copied ? "Link copied" : "Share this location"}
                  </button>
                </div>
                {shareError && (
                  <p role="status" className="small muted">
                    The share link is in your address bar. Copy it to share this
                    point.
                  </p>
                )}
              </>
            )}
          </section>

          <section className="legend-panel" aria-label="Map legend">
            <h2>Reading the map</h2>
            <ul className="legend">
              <li>
                <span className="swatch high" />
                <span>High flood hazard</span>
                <span className="small muted">1%+ / year</span>
              </li>
              <li>
                <span className="swatch moderate" />
                <span>Moderate flood hazard</span>
                <span className="small muted">Usually 0.2%</span>
              </li>
              <li>
                <span className="swatch special" />
                <span>Other / undetermined</span>
              </li>
              <li>
                <span className="swatch minimal" />
                <span>Minimal mapped hazard</span>
                <span className="small muted">Unshaded</span>
              </li>
            </ul>
            <p className="small muted legend-note">
              Unshaded can also mean missing coverage. Tap to check.
            </p>
            <p className="small muted caution">
              FEMA’s mapped zones, not a forecast.
              <br />
              Flooding can happen outside mapped flood areas.
            </p>
            <div className="sidebar-footer">
              <a href={SOURCE_REPO} target="_blank" rel="noreferrer">
                Open source <ArrowUpRight size={14} />
              </a>
              <button onClick={() => setAbout(true)}>
                Sources &amp; limitations
              </button>
            </div>
          </section>
        </aside>

        <section className="map-panel" aria-label="Explore flood zones">
          <MapView
            ref={map}
            selection={selection}
            showOverlay={overlay}
            onSelect={(point) => void selectPoint(point)}
            onStatus={setOverlayStatus}
            onMapError={setMapError}
          />
          <div className="map-topline">
            <button
              className={`overlay-button ${overlay ? "active" : ""}`}
              aria-pressed={overlay}
              onClick={() => setOverlay((value) => !value)}
            >
              <Layers size={17} />
              Flood zones
              <span className="toggle-indicator" aria-hidden="true">
                {overlay ? <Check size={13} strokeWidth={3} /> : null}
              </span>
            </button>
          </div>
          <div
            className={`map-status ${overlayStatus === "error" || mapError ? "map-status-error" : ""}`}
            role="status"
          >
            {mapError ? (
              <span>{mapError}</span>
            ) : overlayStatus === "error" ? (
              <>
                <span>FEMA overlay unavailable</span>
                <button onClick={() => map.current?.retry()}>Retry</button>
              </>
            ) : overlayStatus === "loading" ? (
              <>
                <LoaderCircle size={14} className="spin" />
                <span>Loading FEMA flood zones…</span>
              </>
            ) : overlayStatus === "zoom" ? (
              <button onClick={() => map.current?.zoomIn()}>
                Zoom in to see flood zones <ArrowRight size={14} />
              </button>
            ) : overlayStatus === "hidden" ? (
              <span>Flood-zone overlay hidden</span>
            ) : (
              <>
                <span className="ready-dot" />
                <span>FEMA flood-zone layer</span>
              </>
            )}
          </div>
        </section>
      </main>
      <dialog
        ref={dialog}
        className="about-dialog"
        aria-labelledby="about-title"
        onCancel={() => setAbout(false)}
        onClick={(event) => {
          if (event.target === dialog.current) setAbout(false);
        }}
      >
        <div className="dialog-header">
          <h2 id="about-title">About this map</h2>
          <button
            className="icon-button"
            onClick={() => setAbout(false)}
            aria-label="Close about"
          >
            <X size={23} />
          </button>
        </div>
        <p>
          Flood Map makes FEMA’s current effective flood zones easier to look
          up. It is an independent, open-source project and is not affiliated
          with FEMA.
        </p>
        <h3>Where the data comes from</h3>
        <ul className="source-list">
          <li>
            <a
              href="https://www.fema.gov/flood-maps/national-flood-hazard-layer"
              target="_blank"
              rel="noreferrer"
            >
              FEMA National Flood Hazard Layer <ExternalLink size={14} />
            </a>
            <p>
              Flood-zone boundaries and attributes are queried live. Overlay
              tiles are cached for up to 15 minutes. Panel dates show when the
              map became effective, not when it was checked. Preliminary maps
              and individual Letters of Map Amendment are not included in the
              zone lookup.
            </p>
          </li>
          <li>
            <a
              href="https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html"
              target="_blank"
              rel="noreferrer"
            >
              US Census Bureau <ExternalLink size={14} />
            </a>
            <p>
              US street-address search. Matches are estimated from street ranges
              and may land beside a building. Tap the building to refine the
              point.
            </p>
          </li>
          <li>
            <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
              OpenFreeMap &amp; OpenStreetMap <ExternalLink size={14} />
            </a>
            <p>The street map, rendered with MapLibre GL JS.</p>
          </li>
        </ul>
        <h3>What the map can tell you</h3>
        <p>
          A result describes the selected point, not an entire property. A 1%
          annual chance means that chance each year; it does not mean a flood
          happens once every 100 years. Zone X can mean several different
          things, so the result also uses FEMA’s subtype.
        </p>
        <p>
          Missing data does not mean low risk. FEMA maps do not describe every
          source of flooding, changing conditions, or current weather. Use the
          official FEMA map and your local floodplain administrator for
          property-specific determinations.
        </p>
        <h3>Your searches</h3>
        <p>
          No accounts, analytics, or saved search history. Addresses go to the
          Census Bureau; map and zone requests go to their providers through
          Cloudflare. Share links contain coordinates in the URL fragment, not
          an address.
        </p>
        <a
          className="source-link"
          href={SOURCE_REPO}
          target="_blank"
          rel="noreferrer"
        >
          View the source · MIT license <ArrowUpRight size={17} />
        </a>
      </dialog>
    </>
  );
}
