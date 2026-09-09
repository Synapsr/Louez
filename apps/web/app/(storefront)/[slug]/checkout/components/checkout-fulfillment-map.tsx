"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  AttributionControl,
  Layer,
  Map as MapGl,
  Marker,
  NavigationControl,
  Source,
  type MapRef,
} from "@vis.gl/react-maplibre";
import { Store } from "lucide-react";

import { cn } from "@louez/utils";

import { getOpenFreeMapStyleUrl } from "@/lib/maplibre/map-config";

export interface FulfillmentMapPin {
  id: string;
  latitude: number;
  longitude: number;
  /** Accessible name; also the fallback title on the marker. */
  label: string;
  /** Shown inside a location pin — the row number it belongs to. */
  badge?: string;
  kind?: "location" | "origin" | "destination" | "customer";
}

export interface FulfillmentMapRadius {
  latitude: number;
  longitude: number;
  km: number;
}

interface CheckoutFulfillmentMapProps {
  pins: FulfillmentMapPin[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** The delivery area, drawn as a shaded disc around its centre. */
  radius?: FulfillmentMapRadius | null;
  /** Store → destination, drawn as a dashed line. */
  link?: { from: [number, number]; to: [number, number] } | null;
  /** Rendered above the map; give interactive children `pointer-events-auto`. */
  overlay?: ReactNode;
  className?: string;
}

const KM_PER_DEGREE_LATITUDE = 110.574;
const FIT_PADDING = 56;
const FIT_MAX_ZOOM = 14;
/** Margin a pin needs from the edge to count as visible, clear of the overlays. */
const EDGE_INSET = 56;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const kmPerDegreeLongitude = (latitude: number) => 111.32 * Math.cos((latitude * Math.PI) / 180);

const circleFeature = (latitude: number, longitude: number, km: number, steps = 96) => {
  const perDegreeLongitude = kmPerDegreeLongitude(latitude);
  const ring: Array<[number, number]> = [];

  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * 2 * Math.PI;
    ring.push([
      longitude + (km * Math.cos(angle)) / perDegreeLongitude,
      latitude + (km * Math.sin(angle)) / KM_PER_DEGREE_LATITUDE,
    ]);
  }

  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [ring] },
  };
};

const lineFeature = (from: [number, number], to: [number, number]) => ({
  type: "Feature" as const,
  properties: {},
  geometry: { type: "LineString" as const, coordinates: [from, to] },
});

const isDarkMode = () =>
  typeof document !== "undefined" && document.documentElement.classList.contains("dark");

/**
 * MapLibre paint properties parse CSS colours, not custom properties or the
 * `oklch()` the theme tokens are authored in, so resolve the token to plain
 * sRGB through a canvas before handing it over.
 */
const useResolvedColor = (cssColor: string, fallback: string, revision: unknown) => {
  const [color, setColor] = useState(fallback);

  useEffect(() => {
    const probe = document.createElement("span");
    probe.style.color = cssColor;
    probe.style.display = "none";
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    context.fillStyle = computed;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    setColor(`rgb(${red}, ${green}, ${blue})`);
  }, [cssColor, revision]);

  return color;
};

/**
 * The map behind the checkout fulfillment step: the store's locations, the
 * delivery area, and where the customer is.
 *
 * Gestures are cooperative — ⌘/Ctrl and scroll to zoom, two fingers on touch —
 * so the map never swallows the page scroll.
 */
export const CheckoutFulfillmentMap = ({
  pins,
  selectedId,
  onSelect,
  radius,
  link,
  overlay,
  className,
}: CheckoutFulfillmentMapProps) => {
  const mapRef = useRef<MapRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDark, setIsDark] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsDark(isDarkMode());
    const observer = new MutationObserver(() => setIsDark(isDarkMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const primary = useResolvedColor("var(--primary)", "#0f766e", isDark);

  // A map hidden behind `display: none` measures 0×0, so it has to be told to
  // remeasure when it comes back — that is what lets the step keep one instance
  // alive per leg instead of tearing the map down and rebuilding it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        mapRef.current?.resize();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Everything that must stay in view: the pins, plus the delivery-area box.
  // The customer's own dot is left out on purpose — someone browsing from
  // hundreds of kilometres away would otherwise zoom the map out to nothing.
  const fitTargets: Array<[number, number]> = pins
    .filter((pin) => pin.kind !== "customer")
    .map((pin) => [pin.longitude, pin.latitude]);

  if (radius) {
    const perDegreeLongitude = kmPerDegreeLongitude(radius.latitude);
    fitTargets.push(
      [
        radius.longitude - radius.km / perDegreeLongitude,
        radius.latitude - radius.km / KM_PER_DEGREE_LATITUDE,
      ],
      [
        radius.longitude + radius.km / perDegreeLongitude,
        radius.latitude + radius.km / KM_PER_DEGREE_LATITUDE,
      ],
    );
  }

  // The key is what the effect watches; the ref carries the values, so the
  // targets never have to survive a round trip through JSON to stay typed.
  const fitKey = JSON.stringify(fitTargets);
  const fitTargetsRef = useRef(fitTargets);
  fitTargetsRef.current = fitTargets;

  const fitToTargets = useCallback(() => {
    const map = mapRef.current;
    const targets = fitTargetsRef.current;
    if (!map || targets.length === 0) return;

    const longitudes = targets.map(([longitude]) => longitude);
    const latitudes = targets.map(([, latitude]) => latitude);

    map.fitBounds(
      [
        [Math.min(...longitudes), Math.min(...latitudes)],
        [Math.max(...longitudes), Math.max(...latitudes)],
      ],
      { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, duration: 450 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitKey stands in for the ref's contents
  }, [fitKey]);

  useEffect(() => {
    if (isReady) fitToTargets();
  }, [fitToTargets, isReady]);

  // Bring the chosen pin back into view. Coordinates are read as primitives so
  // this only reacts to the selection changing, never to a re-render — panning
  // the map by hand must not snap it back.
  const selectedPin = pins.find((pin) => pin.id === selectedId) ?? null;
  const selectedLatitude = selectedPin?.latitude ?? null;
  const selectedLongitude = selectedPin?.longitude ?? null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady || selectedLatitude === null || selectedLongitude === null) return;

    // A panel that was hidden still carries its old dimensions until it is told
    // to remeasure, and `project` would answer from those.
    map.resize();

    const container = map.getContainer();
    if (container.clientWidth === 0 || container.clientHeight === 0) return;

    const point = map.project([selectedLongitude, selectedLatitude]);
    const isComfortablyVisible =
      point.x >= EDGE_INSET &&
      point.x <= container.clientWidth - EDGE_INSET &&
      point.y >= EDGE_INSET &&
      point.y <= container.clientHeight - EDGE_INSET;

    // Already on screen and clear of the overlays: leave the view alone.
    if (isComfortablyVisible) return;

    map.easeTo({
      center: [selectedLongitude, selectedLatitude],
      duration: prefersReducedMotion() ? 0 : 500,
    });
  }, [isReady, selectedLatitude, selectedLongitude]);

  const first = pins[0];

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden",
        "[&_.maplibregl-ctrl-attrib]:text-[10px] [&_.maplibregl-ctrl-attrib_a]:text-muted-foreground",
        "[&_.maplibregl-ctrl-group]:overflow-hidden [&_.maplibregl-ctrl-group]:rounded-full! [&_.maplibregl-ctrl-group]:bg-background [&_.maplibregl-ctrl-group]:shadow-raised dark:[&_.maplibregl-ctrl-icon]:invert",
        "[&_.maplibregl-cooperative-gesture-screen]:bg-foreground/60 [&_.maplibregl-cooperative-gesture-screen]:font-sans [&_.maplibregl-cooperative-gesture-screen]:text-background [&_.maplibregl-cooperative-gesture-screen]:text-sm",
        className,
      )}
      data-slot="checkout-fulfillment-map"
    >
      <MapGl
        ref={mapRef}
        initialViewState={{
          longitude: first?.longitude ?? radius?.longitude ?? 0,
          latitude: first?.latitude ?? radius?.latitude ?? 0,
          zoom: 12,
        }}
        mapStyle={getOpenFreeMapStyleUrl(isDark)}
        maxZoom={18}
        cooperativeGestures
        dragRotate={false}
        pitchWithRotate={false}
        attributionControl={false}
        onLoad={() => setIsReady(true)}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="bottom-right" showCompass={false} />
        <AttributionControl position="bottom-left" compact />

        {radius ? (
          <Source
            id="fulfillment-radius"
            type="geojson"
            data={circleFeature(radius.latitude, radius.longitude, radius.km)}
          >
            <Layer
              id="fulfillment-radius-fill"
              type="fill"
              paint={{ "fill-color": primary, "fill-opacity": 0.08 }}
            />
            <Layer
              id="fulfillment-radius-line"
              type="line"
              paint={{
                "line-color": primary,
                "line-width": 1.5,
                "line-opacity": 0.5,
                "line-dasharray": [3, 2],
              }}
            />
          </Source>
        ) : null}

        {link ? (
          <Source id="fulfillment-link" type="geojson" data={lineFeature(link.from, link.to)}>
            <Layer
              id="fulfillment-link-line"
              type="line"
              paint={{ "line-color": primary, "line-width": 2, "line-dasharray": [2, 2] }}
            />
          </Source>
        ) : null}

        {pins.map((pin) => {
          // Where the customer is right now: the familiar dot, in a colour that
          // cannot be mistaken for a selection.
          if (pin.kind === "customer") {
            return (
              <Marker
                key={pin.id}
                longitude={pin.longitude}
                latitude={pin.latitude}
                anchor="center"
              >
                <span className="relative flex size-3.5 items-center justify-center">
                  <span className="absolute size-9 rounded-full bg-info/20" />
                  <span className="size-3.5 rounded-full border-2 border-background bg-info shadow-raised" />
                  <span className="sr-only">{pin.label}</span>
                </span>
              </Marker>
            );
          }

          // Where the equipment starts from: a shop glyph, not a choice.
          if (pin.kind === "origin") {
            return (
              <Marker
                key={pin.id}
                longitude={pin.longitude}
                latitude={pin.latitude}
                anchor="center"
              >
                <span className="flex size-7 items-center justify-center rounded-lg border-2 border-background bg-foreground text-background shadow-raised">
                  <Store aria-hidden className="size-3.5" />
                  <span className="sr-only">{pin.label}</span>
                </span>
              </Marker>
            );
          }

          // The address the equipment is going to.
          if (pin.kind === "destination") {
            return (
              <Marker
                key={pin.id}
                longitude={pin.longitude}
                latitude={pin.latitude}
                anchor="center"
              >
                <span className="relative flex size-4 items-center justify-center">
                  <span className="absolute size-8 rounded-full bg-foreground/15" />
                  <span className="size-4 rounded-full border-[3px] border-background bg-foreground shadow-raised" />
                  <span className="sr-only">{pin.label}</span>
                </span>
              </Marker>
            );
          }

          const isSelected = pin.id === selectedId;

          return (
            <Marker
              key={pin.id}
              longitude={pin.longitude}
              latitude={pin.latitude}
              anchor="bottom"
              ref={(marker) => {
                if (!marker) return;
                const element = marker.getElement();
                element.setAttribute("role", "group");
                element.setAttribute("aria-label", pin.label);
              }}
            >
              <button
                type="button"
                aria-label={pin.label}
                aria-pressed={isSelected}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect?.(pin.id);
                }}
                className={cn(
                  "relative flex flex-col items-center rounded-lg transition-transform duration-200 ease-out focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 motion-reduce:transition-none",
                  isSelected ? "z-10" : "scale-90 hover:scale-100",
                )}
              >
                {/* A rounded square with a tail, so the tip marks the spot and
                    the head matches the number shown on the row. */}
                <span
                  className={cn(
                    "flex items-center justify-center rounded-lg border-2 text-xs font-semibold tabular-nums shadow-raised",
                    isSelected
                      ? "size-9 border-background bg-primary text-primary-foreground"
                      : "size-8 border-background bg-background text-foreground",
                  )}
                >
                  {pin.badge}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "-mt-1 size-2.5 rotate-45 rounded-[2px] border-e-2 border-b-2 border-background",
                    isSelected ? "bg-primary" : "bg-background",
                  )}
                />
              </button>
            </Marker>
          );
        })}
      </MapGl>

      {overlay ? <div className="pointer-events-none absolute inset-0">{overlay}</div> : null}
    </div>
  );
};
