import { ReservationFulfillmentLeg } from "@/components/storefront/account/reservation-fulfillment-leg";
import type { ReservationFulfillment } from "@/lib/reservations/util.reservation-fulfillment";

interface ReservationFulfillmentSummaryProps {
  fulfillment: ReservationFulfillment;
  /** Both formatted in the store timezone. */
  pickupDateLabel: string;
  returnDateLabel: string;
}

/** When and where the equipment is collected, and when and where it goes back. */
export const ReservationFulfillmentSummary = ({
  fulfillment,
  pickupDateLabel,
  returnDateLabel,
}: ReservationFulfillmentSummaryProps) => (
  <div className="grid gap-3 sm:grid-cols-2">
    <ReservationFulfillmentLeg
      leg="pickup"
      place={fulfillment.pickup}
      dateLabel={pickupDateLabel}
    />
    <ReservationFulfillmentLeg
      leg="dropoff"
      place={fulfillment.dropoff}
      dateLabel={returnDateLabel}
      isSamePlace={fulfillment.isSamePlace}
    />
  </div>
);
