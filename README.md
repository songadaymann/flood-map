# Flood Map

[Open the live map](https://flood-map.novox-robot.workers.dev)

A simple, free FEMA flood-zone lookup. Search a US street address, use your location, or tap the map. The map starts in West Hartford, Connecticut and works across available US NFHL coverage.

Built with React, MapLibre GL JS, OpenFreeMap, the US Census Geocoder, and FEMA's live National Flood Hazard Layer. The app and its small API run together on a Cloudflare Worker. No API keys, account signup, database, or paid map service is required.

## Run locally

Requires Node.js 22.12 or newer and npm.

```sh
npm ci
npm run build
npm run preview
```

Open http://localhost:8795. `preview` runs the actual Worker and serves the built frontend; it queries the real public data services.

For frontend hot reload, leave the Worker running and run `npm run dev` in a second terminal. Vite proxies `/api` to port 8795. If you choose a different Worker port, update the proxy in `vite.config.ts`.

## Check and deploy

```sh
npm test
npm run build
npx wrangler deploy --dry-run
npx wrangler login
npm run deploy
```

Choose a unique Worker name in `wrangler.jsonc` when deploying your own copy. Wrangler prints the public URL after deployment. No application environment variables or secrets are needed; see `.env.example`. Deployment authentication belongs in Wrangler's local credential store or your CI secrets, never source control.

## Data and interpretation

- [FEMA NFHL service](https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer): layer **28** supplies flood-zone polygons; layer **3** supplies effective FIRM panel dates. Point queries use exact polygon intersections with `inSR=4326`; no distance buffer is used. The public endpoint is configurable in `src/flood.ts`.
- [Census geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html): full US street addresses only. Searches happen on submission, not every keystroke. Census positions are interpolated along street ranges, not surveyed building or parcel locations. Tap a building to refine the selected point.
- [OpenFreeMap](https://openfreemap.org/quick_start/) and [OpenStreetMap](https://www.openstreetmap.org/copyright): the basemap. The map retains provider attribution. MapLibre is the open-source renderer.

A zone result describes **one point**, not an entire property. Zones A/V and the SFHA flag identify high mapped flood hazard. Zone X is interpreted with its subtype; an unlabeled X is never assumed to be minimal hazard. Zone B may include moderate-hazard conditions beyond the 0.2% floodplain. Overlapping polygons use a conservative category and remain visible in map details. Zone D, missing polygons, failed queries, and truncated responses never become a low-hazard result.

The overlay uses FEMA's actual polygon rendering with custom colors. Transparency is necessary to see streets below the flood layer. Export DPI varies by tile zoom to remain below FEMA's native display-scale cutoff without changing the requested geographic extent; symbol widths compensate for DPI. Overlays appear from neighborhood zoom onward, are cached for up to **15 minutes**, and show an error if they fail. Point results are fetched live with `Cache-Control: no-store`; no stale successful point lookup is substituted after a failure.

This app displays current **effective** NFHL polygons. It does not add preliminary maps or individually apply Letters of Map Amendment (LOMAs); FEMA map revisions incorporated in the NFHL remain part of the upstream dataset. The panel effective date is not a claim that the map was recently studied. Use the official FEMA Map Service Center and a local floodplain administrator for property-specific determinations.

FEMA maps do not represent every cause of flooding or predict current weather. Flooding can occur outside mapped flood areas. This project is independent and is not affiliated with FEMA.

## Privacy

No accounts, analytics, database, or application search history. The Worker forwards addresses to Census and coordinates/tile extents to FEMA. The basemap provider receives normal map requests. Third-party providers and the hosting platform may retain normal operational logs. Application warnings omit addresses, point coordinates, and full upstream URLs. Share links store coordinates in the URL fragment and omit the address text; the coordinates are visible to anyone receiving the link.

## Project layout

- `src/`: interface, map, and conservative zone classification.
- `worker/`: bounded public-service proxy, exact point lookups, and cached overlay tiles.
- `tests/`: zone interpretation, boundary alignment, invalid inputs, upstream failures, and missing-data behavior.
- `ASSETS.md`: icon, basemap, and data provenance.

## License

Code: MIT, copyright Jonathan Mann. Original favicon: CC BY 4.0. Map data, government data, and third-party icons keep their own terms; see [ASSETS.md](ASSETS.md).
