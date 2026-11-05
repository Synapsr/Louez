import type { CustomerFieldAccount } from "@louez/validations";

import type { RentalUnitFormValues } from "@/components/storefront/customer-fields/customer-fields.types";

/** One rented line of `storefront.customerFields.reservationDetails`. */
export interface RentalDetailsItem {
  reservationItemId: string;
  productId: string;
  productName: string;
  productImage: string | null;
  quantity: number;
  /** Fields the checkout asks for this line; `customerEditable` marks those the customer may change. */
  fields: CustomerFieldAccount[];
  /** Exactly `quantity` units. */
  units: { unitIndex: number; participantName: string | null; values: Record<string, string> }[];
}

export interface RentalDetailsData {
  /** Not started, not closed: editable fields may still change. */
  editable: boolean;
  items: RentalDetailsItem[];
}

export interface RentalDetailsFormValues {
  /** Keyed by `toRentalUnitKey(reservationItemId, unitIndex)`. */
  units: Record<string, RentalUnitFormValues>;
}
