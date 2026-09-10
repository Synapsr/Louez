import { useTranslations } from "next-intl";

import { ArrowUpRightIcon, DeliveryTruckIcon, ReturnTruckIcon, StoreIcon } from "@louez/ui/icons";

import {
  getFulfillmentPlaceKey,
  type FulfillmentLeg,
  type FulfillmentPlace,
} from "@/lib/reservations/util.reservation-fulfillment";
import { directionsUrl } from "@/lib/utils/maps-links";

interface ReservationFulfillmentLegProps {
  leg: FulfillmentLeg;
  place: FulfillmentPlace;
  /** Date and time of the leg, formatted in the store timezone. */
  dateLabel: string;
  /** Set on the return leg when the equipment goes back where it was collected. */
  isSamePlace?: boolean;
}

/** One half of the journey: where the equipment is collected, or brought back. */
export const ReservationFulfillmentLeg = ({
  leg,
  place,
  dateLabel,
  isSamePlace = false,
}: ReservationFulfillmentLegProps) => {
  const t = useTranslations("storefront.account.fulfillment");
  const isPickup = leg === "pickup";
  const placeKey = getFulfillmentPlaceKey(place, leg);
  const placeLabel = placeKey ? t(placeKey) : place.name;
  const Icon = place.kind === "store" ? StoreIcon : isPickup ? DeliveryTruckIcon : ReturnTruckIcon;

  return (
    <div className="flex gap-3 rounded-lg bg-muted p-3">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground"
      >
        <Icon className="size-4.5" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">
          {isPickup ? t("pickupTitle") : t("returnTitle")}
        </span>
        <span className="text-sm font-medium">{dateLabel}</span>
        <span className="text-sm">{placeLabel}</span>
        {/* The pickup leg sits right beside this one, so an identical place is
          named once and pointed at once. */}
        {isSamePlace ? (
          <span className="text-xs text-muted-foreground">{t("sameAsPickup")}</span>
        ) : place.address ? (
          <span className="break-words text-xs text-muted-foreground">{place.address}</span>
        ) : null}
        {!isSamePlace && place.kind === "store" && place.address ? (
          <a
            href={directionsUrl(place.address)}
            // Both legs offer "Directions"; the place tells them apart out of context.
            aria-label={`${t("directions")} — ${placeLabel}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-sm text-xs font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("directions")}
            <ArrowUpRightIcon aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
    </div>
  );
};
