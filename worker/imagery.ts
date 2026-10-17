import { IMAGERY_SERVICE } from "../src/flood";
import { tileBounds } from "./tiles";

export function imageryExportUrl(z: number, x: number, y: number): string {
  const params = new URLSearchParams({
    f: "image",
    bbox: tileBounds(z, x, y).join(","),
    bboxSR: "3857",
    imageSR: "3857",
    size: "512,512",
    format: "png32",
    interpolation: "RSP_BilinearInterpolation",
  });
  return `${IMAGERY_SERVICE}/exportImage?${params}`;
}
