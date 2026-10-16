import { FEMA_SERVICE } from "../src/flood";

export function tileBounds(z: number, x: number, y: number): number[] {
  const extent = 20037508.342789244;
  const span = (extent * 2) / 2 ** z;
  return [
    -extent + x * span,
    extent - (y + 1) * span,
    -extent + (x + 1) * span,
    extent - y * span,
  ];
}
const high =
  "((SFHA_TF IS NOT NULL AND SFHA_TF = 'T') OR FLD_ZONE IN ('A','AE','AH','AO','A99','AR','V','VE'))";
const moderate =
  "(FLD_ZONE = 'B' OR (FLD_ZONE = 'X' AND ZONE_SUBTY IS NOT NULL AND ZONE_SUBTY LIKE '%0.2%'))";
const minimal =
  "(FLD_ZONE = 'C' OR (FLD_ZONE = 'X' AND ZONE_SUBTY IS NOT NULL AND ZONE_SUBTY = 'AREA OF MINIMAL FLOOD HAZARD'))";
function layer(
  id: number,
  expression: string,
  color: number[],
  outline: number[],
  dpi: number,
) {
  return {
    id,
    source: { type: "mapLayer", mapLayerId: 28 },
    definitionExpression: expression,
    minScale: 0,
    maxScale: 0,
    drawingInfo: {
      showLabels: false,
      transparency: 0,
      renderer: {
        type: "simple",
        symbol: {
          type: "esriSFS",
          style: "esriSFSSolid",
          color,
          outline: {
            type: "esriSLS",
            style: "esriSLSSolid",
            color: outline,
            width: (0.65 * 96) / dpi,
          },
        },
      },
    },
  };
}
export function tileExportUrl(z: number, x: number, y: number): string {
  // FEMA's source has a scale cutoff. Lower DPI retains the exact tile extent
  // while keeping its display scale below that cutoff at neighborhood zooms.
  const dpi = Math.min(96, 2 * 2 ** (z - 9));
  const dynamicLayers = [
    layer(
      103,
      `${high} AND ZONE_SUBTY LIKE '%FLOODWAY%'`,
      [30, 95, 138, 145],
      [15, 74, 115, 255],
      dpi,
    ),
    layer(102, high, [40, 133, 178, 110], [21, 104, 148, 230], dpi),
    layer(
      101,
      `${moderate} AND NOT ${high}`,
      [231, 178, 68, 125],
      [168, 116, 20, 210],
      dpi,
    ),
    layer(
      100,
      `NOT ${high} AND NOT ${moderate} AND NOT ${minimal}`,
      [126, 131, 128, 100],
      [102, 108, 104, 180],
      dpi,
    ),
  ];
  const params = new URLSearchParams({
    f: "image",
    bbox: tileBounds(z, x, y).join(","),
    bboxSR: "3857",
    imageSR: "3857",
    size: "256,256",
    dpi: String(dpi),
    format: "png32",
    transparent: "true",
    layers: "show:100,101,102,103",
    dynamicLayers: JSON.stringify(dynamicLayers),
  });
  return `${FEMA_SERVICE}/export?${params}`;
}
