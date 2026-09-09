import { getTranslations } from "next-intl/server";

import { MapPinIcon } from "@louez/ui/icons";

import { StoreContactDetails } from "@/components/storefront/home/store-contact-details";
import { StoreMap } from "@/components/storefront/store-map";
import { SectionHeader } from "@/components/storefront/ui/section-header";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";

interface StoreLocationProps {
  name: string;
  address: string;
  phone: string | null;
  email: string | null;
  latitude: string | null;
  longitude: string | null;
}

const buildSearchUrl = (address: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

const toCoordinate = (value: string | null): number | null => {
  const parsed = value === null ? NaN : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Where to pick up: address, phone and email as tappable rows, the map next to them. */
export const StoreLocation = async ({
  name,
  address,
  phone,
  email,
  latitude,
  longitude,
}: StoreLocationProps) => {
  const t = await getTranslations("storefront.home");
  const lat = toCoordinate(latitude);
  const lng = toCoordinate(longitude);
  return (
    <StorefrontSection id="contact" aria-labelledby="store-location-title">
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        <div>
          <SectionHeader id="store-location-title" title={t("findUs")} />
          <StoreContactDetails address={address} phone={phone} email={email} />
        </div>

        <div className="h-64 overflow-hidden rounded-2xl bg-muted sm:h-80 lg:h-96">
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
      </div>
    </StorefrontSection>
  );
};
