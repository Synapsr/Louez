import type { ComponentType } from "react";

import {
  DeliveryTruckIcon,
  InstantConfirmationIcon,
  LocalPickupIcon,
  RequestConfirmationIcon,
  SecurePaymentIcon,
} from "@louez/ui/icons";

import type { StoreReassuranceKey } from "@/lib/utils/util.store-reassurance";

/** One icon per reassurance, shared by the hero line and the embed widget. */
export const STORE_REASSURANCE_ICONS: Record<
  StoreReassuranceKey,
  ComponentType<{ className?: string }>
> = {
  instantConfirmation: InstantConfirmationIcon,
  requestConfirmation: RequestConfirmationIcon,
  securePayment: SecurePaymentIcon,
  localPickup: LocalPickupIcon,
  localPickupOrDelivery: DeliveryTruckIcon,
};
