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
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui/components/button";
import { ArrowUpRightIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { MapPinMarker } from "@/components/ui/map-pin-marker";
import { getOpenFreeMapStyleUrl } from "@/lib/maplibre/map-config";

interface StoreMapProps {
  latitude: number;
  longitude: number;
  storeName: string;
  address?: string;
  className?: string;
  interactive?: boolean;
  showZoomControl?: boolean;
  /** `auto` follows the store theme mode (the `dark` class on `<html>`). */
  tileTheme?: "auto" | "light" | "dark";
}

const STORE_ZOOM = 14;

const isDarkMode = () =>
  typeof document !== "undefined" && document.documentElement.classList.contains("dark");

/**
 * The store on a map, with a popup on the pin (name, address, directions).
 * Colours come from the theme tokens: the pin is the primary colour, the
 * popup a popover surface.
 */
export const StoreMap = ({
  latitude,
  longitude,
  storeName,
  address,
  className,
  interactive = true,
  showZoomControl = true,
  tileTheme = "auto",
}: StoreMapProps) => {
  const t = useTranslations();
  const mapRef = useRef<MapRef>(null);
  const [isDark, setIsDark] = useState(false);
  const [isPopupOpen, setIsPopupOpen] = useState(false);

  useEffect(() => {
    setIsDark(isDarkMode());

    const observer = new MutationObserver(() => {
      setIsDark(isDarkMode());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  const mapIsDark = tileTheme === "dark" || (tileTheme === "auto" && isDark);
  const directionsUrl = address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
    : null;

  return (
    <div
      role="region"
      aria-label={t("storefront.home.map", { store: storeName })}
      className={cn(
        "relative h-full min-h-full overflow-hidden [container-type:size]",
        "[&_.maplibregl-popup-content]:max-h-[calc(100cqh-7rem)] [&_.maplibregl-popup-content]:overflow-y-auto",
        "[&_.maplibregl-ctrl-attrib]:text-xs [&_.maplibregl-ctrl-attrib_a]:text-muted-foreground",
        "[&_.maplibregl-popup-content]:rounded-2xl! [&_.maplibregl-popup-content]:bg-popover [&_.maplibregl-popup-content]:p-5! [&_.maplibregl-popup-content]:font-sans! [&_.maplibregl-popup-content]:ring-1 [&_.maplibregl-popup-content]:ring-border/50 [&_.maplibregl-popup-content]:text-popover-foreground [&_.maplibregl-popup-content]:shadow-raised",
        "[&_.maplibregl-popup-tip]:hidden",
        "[&_.maplibregl-ctrl-group]:overflow-hidden [&_.maplibregl-ctrl-group]:rounded-full! [&_.maplibregl-ctrl-group]:bg-background [&_.maplibregl-ctrl-group]:shadow-raised [&_.maplibregl-ctrl-group_button]:size-11! dark:[&_.maplibregl-ctrl-icon]:invert",
        className,
      )}
      data-slot="store-map"
    >
      <MapGl
        ref={mapRef}
        initialViewState={{ longitude, latitude, zoom: STORE_ZOOM }}
        mapStyle={getOpenFreeMapStyleUrl(mapIsDark)}
        maxZoom={20}
        dragPan={interactive}
        scrollZoom={interactive}
        cooperativeGestures={interactive}
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
        {showZoomControl ? <NavigationControl position="bottom-right" showCompass={false} /> : null}
        <AttributionControl position="bottom-left" compact={false} />

        <Marker longitude={longitude} latitude={latitude} anchor="bottom">
          <Button
            variant="ghost"
            size="icon-lg"
            className="rounded-full hover:bg-transparent [&_svg]:h-10! [&_svg]:w-8!"
            aria-label={storeName}
            aria-expanded={isPopupOpen}
            onClick={(event) => {
              event.stopPropagation();
              if (!isPopupOpen && mapRef.current) {
                const map = mapRef.current;
                const height = map.getContainer().clientHeight;
                map.stop();
                map.easeTo({
                  center: [longitude, latitude],
                  offset: [0, height / 2 - 56],
                  duration: 0,
                });
              }
              setIsPopupOpen((open) => !open);
            }}
          >
            <MapPinMarker color="var(--primary)" />
          </Button>
        </Marker>

        {isPopupOpen ? (
          <Popup
            longitude={longitude}
            latitude={latitude}
            anchor="bottom"
            offset={48}
            closeOnMove
            maxWidth="min(280px, calc(100vw - 48px))"
            closeButton={false}
            closeOnClick={false}
            onClose={() => {
              setIsPopupOpen(false);
            }}
          >
            <div
              className="flex min-w-45 flex-col gap-4"
              onKeyDown={(event) => {
                if (event.key === "Escape") setIsPopupOpen(false);
              }}
            >
              <div className="pr-7">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-2 top-2 rounded-full text-muted-foreground"
                  aria-label={t("common.close")}
                  onClick={() => setIsPopupOpen(false)}
                >
                  <span aria-hidden className="text-xl font-normal">
                    ×
                  </span>
                </Button>
                <p className="text-base font-semibold leading-snug">{storeName}</p>
                {address ? (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{address}</p>
                ) : null}
              </div>
              {directionsUrl ? (
                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-muted px-4 text-sm font-medium text-foreground no-underline transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {t("storefront.home.getDirections")}
                  <ArrowUpRightIcon aria-hidden className="size-4" />
                </a>
              ) : null}
            </div>
          </Popup>
        ) : null}
      </MapGl>
    </div>
  );
};
