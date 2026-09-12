import { OpeningHoursCard } from "@/components/storefront/about/opening-hours-card";
import { StoreMapPanel } from "@/components/storefront/home/store-map-panel";
import type { BusinessHours } from "@louez/types";

interface ContactAsideProps {
  name: string;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  businessHours: BusinessHours | undefined;
  timezone: string | undefined;
  /** `column` stacks map then hours; `row` puts them side by side from `lg`. */
  direction: "column" | "row";
}

/** Where and when to find the store: the map and the opening hours, in a column or a row. */
export const ContactAside = ({
  name,
  address,
  latitude,
  longitude,
  businessHours,
  timezone,
  direction,
}: ContactAsideProps) => (
  <div
    className={direction === "row" ? "grid gap-8 lg:grid-cols-2 lg:gap-12" : "flex flex-col gap-8"}
  >
    {address ? (
      <StoreMapPanel
        name={name}
        address={address}
        latitude={latitude}
        longitude={longitude}
        className={direction === "row" ? "h-64 sm:h-80" : "h-56 sm:h-64"}
      />
    ) : null}
    <OpeningHoursCard businessHours={businessHours} timezone={timezone} />
  </div>
);
