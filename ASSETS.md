# Assets

Application code is MIT; see [LICENSE](LICENSE). Map and government data keep their own terms.

## 1. Ours: included and open

The original wave favicon (`public/favicon.svg`) is CC BY 4.0, credit Jonathan Mann (Song A Day).

## 2. Free third-party: included or loaded under their own terms

| Asset                                                             | Source                                                                | Terms                                                                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Interface icons, bundled from lucide-react                        | https://lucide.dev/license                                            | ISC                                                                                                   |
| Basemap tiles, styles, and map fonts, loaded at runtime           | https://openfreemap.org/quick_start/                                  | OpenFreeMap service; OpenMapTiles attribution and OpenStreetMap ODbL data attribution retained on map |
| Flood boundaries, zone attributes, FIRM panels, loaded at runtime | https://www.fema.gov/flood-maps/national-flood-hazard-layer           | FEMA public NFHL data; source links and limitations retained in the app                               |
| Address matches, loaded at runtime                                | https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html | US Census Bureau public geocoding service; approximate, street-range address positions                |

Map data is fetched from the providers and is not bundled or relicensed as MIT. No web fonts are downloaded or vendored; the interface uses system fonts.

Satellite view streams USGS / USDA imagery from these public services; no imagery source files are included in this repository:

- [USGS NAIP Imagery](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer): high-resolution public-domain federal aerial imagery in the contiguous United States, via `worker/imagery.ts`. Provider credits are shown on the map. Capture dates and detail vary.
- [USGS Imagery Only](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer): overview imagery and coverage outside the NAIP detail footprint. This service includes partner imagery with its own restrictions, including licensed Alaska imagery. Stream for display with USGS/USDA attribution; no offline export or source redistribution is provided by this project.

## 3. Licensed (paid or restricted): not included

None.

## 4. Not ours and not licensed: never in the repo

None. No private addresses, query logs, or user records are included.
