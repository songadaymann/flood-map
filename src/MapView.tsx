import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  Map as LibreMap,
  Marker,
  AttributionControl,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type MapSourceDataEvent,
  type RasterTileSource,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { DEFAULT_VIEW, MAP_STYLE, readPoint } from "./flood";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(workerUrl);

export interface Selection {
  lng: number;
  lat: number;
  label: string;
  approximate: boolean;
  fly: boolean;
}
export type OverlayStatus = "loading" | "ready" | "error" | "zoom" | "hidden";
export interface MapHandle {
  shareUrl: () => string;
  retry: () => void;
  zoomIn: () => void;
}
const initialParams = new URLSearchParams(window.location.hash.slice(1));
export const initialView = readPoint(initialParams) || DEFAULT_VIEW;
const parsedZoom = Number(initialParams.get("z"));
export const initialZoom =
  initialParams.has("z") &&
  Number.isFinite(parsedZoom) &&
  parsedZoom >= 3 &&
  parsedZoom <= 19
    ? parsedZoom
    : DEFAULT_VIEW.zoom;
export const initialPoint = readPoint(
  new URLSearchParams({
    lat: initialParams.get("plat") || "",
    lng: initialParams.get("plng") || "",
  }),
);

interface Props {
  selection: Selection | null;
  showOverlay: boolean;
  onSelect: (point: Selection) => void;
  onStatus: (status: OverlayStatus) => void;
  onMapError: (error: string) => void;
}

export const MapView = forwardRef<MapHandle, Props>(function MapView(
  { selection, showOverlay, onSelect, onStatus, onMapError },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const selectionRef = useRef(selection);
  const overlayRef = useRef(showOverlay);
  const failed = useRef(false);
  const callbacks = useRef({ onSelect, onStatus, onMapError });
  callbacks.current = { onSelect, onStatus, onMapError };
  selectionRef.current = selection;
  overlayRef.current = showOverlay;

  function shareUrl() {
    const map = mapRef.current;
    const center = map?.getCenter().wrap() || initialView;
    const params = new URLSearchParams({
      lat: center.lat.toFixed(6),
      lng: center.lng.toFixed(6),
      z: (map?.getZoom() || initialZoom).toFixed(2),
    });
    if (selectionRef.current) {
      params.set("plat", selectionRef.current.lat.toFixed(6));
      params.set("plng", selectionRef.current.lng.toFixed(6));
    }
    return `${window.location.origin}${window.location.pathname}#${params}`;
  }

  function keepSelectionVisible() {
    const map = mapRef.current;
    const point = selectionRef.current;
    if (!map || !point) return;
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    if (!width || !height) return;
    const position = map.project([point.lng, point.lat]);
    if (
      position.x < 30 ||
      position.x > width - 30 ||
      position.y < 60 ||
      position.y > height - 30
    ) {
      map.jumpTo({ center: [point.lng, point.lat] });
    }
  }

  useImperativeHandle(ref, () => ({
    shareUrl,
    retry() {
      failed.current = false;
      callbacks.current.onStatus("loading");
      const source = mapRef.current?.getSource("fema") as
        RasterTileSource | undefined;
      source?.setTiles([
        `${window.location.origin}/api/tiles/{z}/{x}/{y}.png?retry=${Date.now()}`,
      ]);
    },
    zoomIn() {
      mapRef.current?.zoomTo(12, { duration: 500 });
    },
  }));

  useEffect(() => {
    if (!container.current) return;
    let map: LibreMap;
    try {
      map = new LibreMap({
        container: container.current,
        style: MAP_STYLE,
        center: [initialView.lng, initialView.lat],
        zoom: initialZoom,
        minZoom: 3,
        maxZoom: 19,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
      });
    } catch {
      callbacks.current.onMapError(
        "This browser could not display the map. You can still search an address.",
      );
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new ScaleControl({ maxWidth: 100, unit: "imperial" }),
      "bottom-left",
    );
    map.addControl(
      new AttributionControl({
        compact: false,
        customAttribution:
          '<a href="https://www.fema.gov/flood-maps/national-flood-hazard-layer" target="_blank" rel="noopener noreferrer">FEMA NFHL</a>',
      }),
      "bottom-right",
    );
    function updateStatus() {
      if (!overlayRef.current) callbacks.current.onStatus("hidden");
      else if (map.getZoom() < 9) callbacks.current.onStatus("zoom");
      else if (failed.current) callbacks.current.onStatus("error");
      else if (!map.getSource("fema")) callbacks.current.onStatus("loading");
      else
        callbacks.current.onStatus(
          map.isSourceLoaded("fema") ? "ready" : "loading",
        );
    }
    map.on("load", () => {
      callbacks.current.onMapError("");
      map.addSource("fema", {
        type: "raster",
        tiles: [`${window.location.origin}/api/tiles/{z}/{x}/{y}.png`],
        tileSize: 256,
        minzoom: 9,
        maxzoom: 16,
      });
      const firstLabel = map
        .getStyle()
        .layers.find((layer) => layer.type === "symbol")?.id;
      map.addLayer(
        {
          id: "fema-zones",
          type: "raster",
          source: "fema",
          minzoom: 9,
          layout: { visibility: overlayRef.current ? "visible" : "none" },
          paint: { "raster-opacity": 1, "raster-fade-duration": 0 },
        },
        firstLabel,
      );
      updateStatus();
    });
    map.on("sourcedata", (event: MapSourceDataEvent) => {
      if (event.sourceId === "fema") updateStatus();
    });
    map.on("dataloading", (event) => {
      if ("sourceId" in event && event.sourceId === "fema") updateStatus();
    });
    map.on("error", (event) => {
      if ("sourceId" in event && event.sourceId === "fema") {
        failed.current = true;
        callbacks.current.onStatus("error");
      } else if (!map.isStyleLoaded())
        callbacks.current.onMapError(
          "The street map is unavailable. Address lookup still works.",
        );
    });
    map.on("zoomend", updateStatus);
    map.on("resize", keepSelectionVisible);
    map.on("moveend", () => {
      history.replaceState(null, "", shareUrl());
    });
    map.on("click", (event) => {
      callbacks.current.onSelect({
        lng: event.lngLat.wrap().lng,
        lat: event.lngLat.lat,
        label: "Selected point",
        approximate: false,
        fly: false,
      });
    });
    return () => {
      markerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (selection) {
      const element = document.createElement("div");
      element.className = "map-pin";
      element.setAttribute("aria-hidden", "true");
      element.innerHTML =
        '<svg width="38" height="48" viewBox="0 0 38 48"><path d="M19 1C9 1 1 9 1 19c0 13 18 28 18 28s18-15 18-28C37 9 29 1 19 1Z" fill="#173e43" stroke="#fff" stroke-width="2"/><circle cx="19" cy="18" r="6" fill="#c6f05b"/></svg>';
      markerRef.current = new Marker({ element, anchor: "bottom" })
        .setLngLat([selection.lng, selection.lat])
        .addTo(map);
      if (selection.fly)
        map.flyTo({
          center: [selection.lng, selection.lat],
          zoom: Math.max(map.getZoom(), 15.5),
          duration: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? 0
            : 900,
        });
      else keepSelectionVisible();
    }
    history.replaceState(null, "", shareUrl());
  }, [selection]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("fema-zones")) {
      map.setLayoutProperty(
        "fema-zones",
        "visibility",
        showOverlay ? "visible" : "none",
      );
      onStatus(
        !showOverlay
          ? "hidden"
          : map.getZoom() < 9
            ? "zoom"
            : failed.current
              ? "error"
              : map.isSourceLoaded("fema")
                ? "ready"
                : "loading",
      );
    }
  }, [showOverlay]);
  return (
    <div
      ref={container}
      className="map-canvas"
      role="region"
      aria-label="Interactive flood map. Search an address for a keyboard-accessible flood zone lookup."
    />
  );
});
