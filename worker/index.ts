import {
  FEMA_SERVICE,
  readPoint,
  type AddressMatch,
  type PanelAttributes,
  type ZoneAttributes,
} from "../src/flood";
import { tileExportUrl } from "./tiles";

class UpstreamError extends Error {}

async function fetchUpstream(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(14000),
        headers: {
          Accept: "application/json,image/png",
          "User-Agent":
            "FloodMap/1.0 (+https://github.com/songadaymann/flood-map)",
        },
      });
      if (response.ok) return response;
      console.warn({
        event: "upstream_http_error",
        host: new URL(url).hostname,
        status: response.status,
      });
      await response.body?.cancel();
      if (response.status < 500)
        throw new UpstreamError("The data service rejected the request.");
    } catch (error) {
      if (error instanceof UpstreamError || attempt === 1)
        throw new UpstreamError("The data service is temporarily unavailable.");
    }
  }
  throw new UpstreamError("The data service is temporarily unavailable.");
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.headers.get("content-type")?.includes("json")) {
    await response.body?.cancel();
    throw new UpstreamError(
      "The data service returned an unexpected response.",
    );
  }
  // These endpoints return a few attributes, never geometry or full datasets.
  const reader = response.body?.getReader();
  if (!reader) throw new UpstreamError("The data service returned no data.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 1_000_000) {
      await reader.cancel();
      throw new UpstreamError("The data response was too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new UpstreamError("The data service returned invalid data.");
  }
}

async function queryPoint<T>(
  layer: number,
  lng: number,
  lat: number,
  fields: string,
): Promise<T[]> {
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    geometry: JSON.stringify({
      x: lng,
      y: lat,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: fields,
    returnGeometry: "false",
    resultRecordCount: "20",
  });
  const json = await readJson<{
    error?: unknown;
    features?: { attributes: T }[];
    exceededTransferLimit?: boolean;
  }>(await fetchUpstream(`${FEMA_SERVICE}/${layer}/query?${params}`));
  if (
    json.error ||
    !Array.isArray(json.features) ||
    json.exceededTransferLimit ||
    json.features.some((feature) => !feature.attributes)
  )
    throw new UpstreamError("FEMA could not complete this flood-zone lookup.");
  return json.features.map((feature) => feature.attributes);
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET")
      return jsonResponse({ error: "Use a GET request." }, 405);
    try {
      if (url.pathname === "/api/search") {
        const address = url.searchParams.get("q")?.trim();
        if (!address || address.length < 3 || address.length > 100)
          return jsonResponse(
            {
              error:
                "Enter a street address, city, and state (up to 100 characters).",
            },
            400,
          );
        const params = new URLSearchParams({
          address,
          benchmark: "Public_AR_Current",
          format: "json",
        });
        const data = await readJson<{
          result?: {
            addressMatches?: {
              matchedAddress: string;
              coordinates: { x: number; y: number };
            }[];
          };
        }>(
          await fetchUpstream(
            `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`,
          ),
        );
        if (!Array.isArray(data.result?.addressMatches))
          throw new UpstreamError("Address search is temporarily unavailable.");
        const matches: AddressMatch[] = data.result.addressMatches
          .slice(0, 8)
          .filter(
            (match) =>
              Number.isFinite(match.coordinates?.x) &&
              Number.isFinite(match.coordinates?.y),
          )
          .map((match) => ({
            label: match.matchedAddress,
            lng: match.coordinates.x,
            lat: match.coordinates.y,
          }));
        return jsonResponse({ matches, provider: "US Census Bureau" });
      }
      if (url.pathname === "/api/flood") {
        const point = readPoint(url.searchParams);
        if (!point)
          return jsonResponse(
            { error: "Provide valid longitude and latitude." },
            400,
          );
        const [zoneResult, panelResult] = await Promise.allSettled([
          queryPoint<ZoneAttributes>(
            28,
            point.lng,
            point.lat,
            "FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID,STATIC_BFE,V_DATUM,LEN_UNIT",
          ),
          queryPoint<PanelAttributes>(
            3,
            point.lng,
            point.lat,
            "FIRM_PAN,EFF_DATE",
          ),
        ]);
        if (zoneResult.status === "rejected") throw zoneResult.reason;
        return jsonResponse({
          zones: zoneResult.value,
          panels: panelResult.status === "fulfilled" ? panelResult.value : [],
          panelStatus:
            panelResult.status === "fulfilled" ? "available" : "unavailable",
          checkedAt: new Date().toISOString(),
        });
      }
      const tile = url.pathname.match(
        /^\/api\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/,
      );
      if (tile) {
        const [z, x, y] = tile.slice(1).map(Number);
        if (z < 9 || z > 16 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z)
          return jsonResponse({ error: "Invalid map tile." }, 400);
        const cache = await caches.open("fema-overlay-v1");
        const cacheKey = new Request(`${url.origin}${url.pathname}`, {
          method: "GET",
        });
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        const upstream = await fetchUpstream(tileExportUrl(z, x, y));
        if (!upstream.headers.get("content-type")?.includes("image/png")) {
          await upstream.body?.cancel();
          throw new UpstreamError("FEMA could not render the flood overlay.");
        }
        const response = new Response(upstream.body, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=900",
            "X-Content-Type-Options": "nosniff",
          },
        });
        ctx.waitUntil(
          cache.put(cacheKey, response.clone()).catch(() => undefined),
        );
        return response;
      }
      return jsonResponse({ error: "Not found." }, 404);
    } catch (error) {
      console.warn({
        event: "data_service_unavailable",
        endpoint: url.pathname.split("/")[2],
        error:
          error instanceof UpstreamError
            ? error.message
            : "Unexpected service error",
      });
      // Deliberately omit addresses, coordinates, and upstream request URLs from logs.
      return jsonResponse(
        {
          error:
            url.pathname === "/api/search"
              ? "Address search is unavailable right now. Please try again, or tap the map."
              : "FEMA is unavailable right now. Please retry or open the official FEMA map.",
        },
        503,
      );
    }
  },
} satisfies ExportedHandler<Env>;
