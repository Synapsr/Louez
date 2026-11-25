"use client";

import { useEffect, useRef, useState } from "react";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

import { MapPinIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

const StoreMap = dynamic(
  () => import("@/components/storefront/store-map").then((module) => module.StoreMap),
  { ssr: false },
);

interface StoreMapLazyProps {
  latitude: number;
  longitude: number;
  storeName: string;
  address: string;
  className?: string;
}

const buildSearchUrl = (address: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

export const StoreMapLazy = ({
  latitude,
  longitude,
  storeName,
  address,
  className,
}: StoreMapLazyProps) => {
  const t = useTranslations("storefront.home");
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoadMap, setShouldLoadMap] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!("IntersectionObserver" in window)) {
      setShouldLoadMap(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldLoadMap(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("overflow-hidden rounded-2xl bg-muted", className)}
      data-slot="store-map-lazy"
    >
      {shouldLoadMap ? (
        <StoreMap
          latitude={latitude}
          longitude={longitude}
          storeName={storeName}
          address={address}
          tileTheme="auto"
          className="h-full w-full"
        />
      ) : (
        <a
          href={buildSearchUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center transition-colors hover:bg-muted/70"
        >
          <MapPinIcon aria-hidden className="size-8 text-muted-foreground" />
          <span className="text-sm font-medium">{t("viewOnMap")}</span>
        </a>
      )}
    </div>
  );
};
