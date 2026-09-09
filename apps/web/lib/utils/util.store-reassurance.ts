import type { StoreSettings } from "@louez/types";

import { getEffectiveReservationMode } from "@/lib/reservation-mode";

export type StoreReassuranceKey =
  | "instantConfirmation"
  | "requestConfirmation"
  | "securePayment"
  | "localPickup"
  | "localPickupOrDelivery";

export interface StoreReassuranceInput {
  settings: Pick<StoreSettings, "reservationMode" | "delivery"> | null | undefined;
  stripeAccountId?: string | null;
  stripeChargesEnabled?: boolean | null;
}

/**
 * The one reassurance line of the home page, derived from what the store
 * actually does: instant confirmation and secure payment only when Stripe
 * can charge (payment mode degrades to request until then), delivery only
 * when it is enabled.
 */
export const getStoreReassurance = ({
  settings,
  stripeAccountId,
  stripeChargesEnabled,
}: StoreReassuranceInput): StoreReassuranceKey[] => {
  const mode = getEffectiveReservationMode({ settings, stripeAccountId, stripeChargesEnabled });
  const items: StoreReassuranceKey[] =
    mode === "payment" ? ["instantConfirmation", "securePayment"] : ["requestConfirmation"];

  items.push(settings?.delivery?.enabled ? "localPickupOrDelivery" : "localPickup");

  return items;
};
