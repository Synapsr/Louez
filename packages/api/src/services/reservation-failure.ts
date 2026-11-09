import type { CheckoutFieldIssue } from "@louez/validations";

import type { MissingRequiredAccessory } from "./required-accessories";

// A reservation step that did not go through: a translation key with its
// params, and structured details. Checkout, the dashboard and the inventory
// check answer with it.

export type ReservationErrorParams = Record<string, string | number>;

export type ReservationFailureDetails =
  | {
      code: "required_accessories_missing";
      missingAccessories: MissingRequiredAccessory[];
    }
  | {
      /** Custom fields the checkout asked: every issue, the error names the first. */
      code: "checkout_fields_invalid";
      issues: CheckoutFieldIssue[];
    };

/** Every non-success outcome of the reservation pipeline (translation key + params). */
export type ReservationFailure = {
  ok: false;
  error: string;
  params?: ReservationErrorParams;
  details?: ReservationFailureDetails;
};

export const failReservation = (
  error: string,
  params?: ReservationErrorParams,
  details?: ReservationFailureDetails,
): ReservationFailure => ({
  ok: false,
  error,
  ...(params ? { params } : {}),
  ...(details ? { details } : {}),
});
