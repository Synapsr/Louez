"use client";

import { useEffect, useRef, useState } from "react";

import {
  AttributionControl,
  Map as MapGl,
  Marker,
  NavigationControl,
  Popup,
  type MapRef,
} from "@vis.gl/react-maplibre";
import { Crosshair } from "lucide-react";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import { MapPinMarker } from "@/components/ui/map-pin-marker";
import { getOpenFreeMapStyleUrl } from "@/lib/maplibre/map-config";

interface StoreMapProps {
  latitude: number;
  longitude: number;
  storeName: string;
  address?: string;
  className?: string;
  primaryColor?: string;
  interactive?: boolean;
  showZoomControl?: boolean;
  showRecenterControl?: boolean;
  tileTheme?: "auto" | "light" | "dark";
  popupTheme?: "auto" | "light" | "dark";
  directionsLabel?: string;
}

const isDarkMode = () =>
  typeof document !== "undefined" && document.documentElement.classList.contains("dark");

export const StoreMap = ({
  latitude,
  longitude,
  storeName,
  address,
  className,
  primaryColor = "#0066FF",
  interactive = true,
  showZoomControl = true,
  showRecenterControl = false,
  tileTheme = "auto",
  popupTheme = "auto",
  directionsLabel,
}: StoreMapProps) => {
  const mapRef = useRef<MapRef>(null);
  const [isDark, setIsDark] = useState(false);
  const [isPopupOpen, setIsPopupOpen] = useState(false);

  useEffect(() => {
    setIsDark(isDarkMode());

    const observer = new MutationObserver(() => {
      setIsDark(isDarkMode());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  const mapIsDark = tileTheme === "dark" || (tileTheme === "auto" && isDark);
  const popupIsDark = popupTheme === "dark" || (popupTheme === "auto" && isDark);
  const directionsUrl = address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
    : null;

  return (
    <div
      className={cn(
        "relative h-full min-h-full overflow-hidden rounded-lg",
        "[&_.maplibregl-ctrl-attrib]:text-[10px] [&_.maplibregl-ctrl-attrib_a]:text-zinc-500",
        "[&_.maplibregl-popup-content]:rounded-xl [&_.maplibregl-popup-content]:p-3 [&_.maplibregl-popup-content]:shadow-xl",
        popupIsDark
          ? "[&_.maplibregl-popup-content]:bg-zinc-800 [&_.maplibregl-popup-tip]:border-t-zinc-800"
          : "[&_.maplibregl-popup-content]:bg-white [&_.maplibregl-popup-tip]:border-t-white",
        className,
      )}
    >
      <MapGl
        ref={mapRef}
        initialViewState={{ longitude, latitude, zoom: 14 }}
        mapStyle={getOpenFreeMapStyleUrl(mapIsDark)}
        maxZoom={20}
        dragPan={interactive}
        scrollZoom={interactive}
        doubleClickZoom={interactive}
        boxZoom={interactive}
        keyboard={interactive}
        touchZoomRotate={interactive}
        dragRotate={false}
        pitchWithRotate={false}
        attributionControl={false}
        onClick={() => {
          setIsPopupOpen(false);
        }}
        style={{ width: "100%", height: "100%" }}
      >
        {showZoomControl ? <NavigationControl showCompass={false} /> : null}
        <AttributionControl position="bottom-left" compact={false} />

        <Marker
          longitude={longitude}
          latitude={latitude}
          anchor="bottom"
          onClick={(event) => {
            event.originalEvent.stopPropagation();
            setIsPopupOpen(true);
          }}
        >
          <MapPinMarker color={primaryColor} />
        </Marker>

        {isPopupOpen ? (
          <Popup
            longitude={longitude}
            latitude={latitude}
            anchor="bottom"
            offset={44}
            closeButton={false}
            closeOnClick={false}
            onClose={() => {
              setIsPopupOpen(false);
            }}
          >
            <div className="min-w-45">
              <p
                className={cn(
                  "mb-0.5 text-[13px] font-semibold",
                  popupIsDark ? "text-zinc-100" : "text-zinc-900",
                )}
              >
                {storeName}
              </p>
              {address ? (
                <p
                  className={cn(
                    directionsUrl && directionsLabel ? "mb-2.5" : "mb-0",
                    "text-xs leading-snug",
                    popupIsDark ? "text-zinc-300" : "text-zinc-500",
                  )}
                >
                  {address}
                </p>
              ) : null}
              {directionsUrl && directionsLabel ? (
                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white no-underline"
                  style={{ backgroundColor: primaryColor }}
                >
                  {directionsLabel}
                </a>
              ) : null}
            </div>
          </Popup>
        ) : null}
      </MapGl>

      {showRecenterControl ? (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          title="Recenter"
          aria-label="Recenter"
          onClick={() => {
            mapRef.current?.flyTo({
              center: [longitude, latitude],
              zoom: 14,
              duration: 600,
            });
          }}
          className="absolute right-2 bottom-7 z-10 border-zinc-700 bg-zinc-800 text-zinc-400 shadow-md hover:bg-zinc-700 hover:text-zinc-200"
        >
          <Crosshair className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  );
};
