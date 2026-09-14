import { getTranslations } from "next-intl/server";

import { MapPinIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { StoreMap } from "@/components/storefront/store-map";

interface StoreMapPanelProps {
  name: string;
  address: string;
  latitude: string | null;
  longitude: string | null;
  className?: string;
}

const buildSearchUrl = (address: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

const toCoordinate = (value: string | null): number | null => {
  const parsed = value === null ? NaN : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** The store on a map when its coordinates are known, a "view on map" link otherwise. */
export const StoreMapPanel = async ({
  name,
  address,
  latitude,
  longitude,
  className,
}: StoreMapPanelProps) => {
  const t = await getTranslations("storefront.home");
  const lat = toCoordinate(latitude);
  const lng = toCoordinate(longitude);

  return (
    <div className={cn("overflow-hidden rounded-2xl bg-muted", className)}>
      {lat !== null && lng !== null ? (
        <StoreMap
          latitude={lat}
          longitude={lng}
          storeName={name}
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
