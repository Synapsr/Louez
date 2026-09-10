/**
 * Decides whether a re-submitted checkout is the same booking as a pending
 * reservation left behind by an earlier attempt (the customer backed out of
 * Stripe and came back). The comparison runs on the rows the checkout is
 * about to write against the rows already stored: identical rows mean the
 * customer changed nothing and the first reservation can carry the payment.
 */

/** `reservations` columns that describe what the customer chose. */
export const PENDING_CHECKOUT_RESERVATION_KEYS = [
  "customerId",
  "startDate",
  "endDate",
  "subtotalAmount",
  "depositAmount",
  "totalAmount",
  "subtotalExclTax",
  "taxAmount",
  "taxRate",
  "customerNotes",
  "source",
  "billingSnapshot",
  "outboundMethod",
  "returnMethod",
  "deliveryOption",
  "deliveryAddress",
  "deliveryCity",
  "deliveryPostalCode",
  "deliveryCountry",
  "deliveryLatitude",
  "deliveryLongitude",
  "deliveryDistanceKm",
  "deliveryFee",
  "tulipInsuranceOptIn",
  "tulipInsuranceAmount",
  "promoCodeId",
  "discountAmount",
  "promoCodeSnapshot",
  "returnAddress",
  "returnCity",
  "returnPostalCode",
  "returnCountry",
  "returnLatitude",
  "returnLongitude",
  "returnDistanceKm",
  "pickupLocationId",
  "returnLocationId",
  "pickupLocationSnapshot",
  "returnLocationSnapshot",
] as const;

/** `reservation_items` columns that describe a line (snapshots excluded: a renamed product is not a changed cart). */
export const PENDING_CHECKOUT_ITEM_KEYS = [
  "productId",
  "isCustomItem",
  "quantity",
  "unitPrice",
  "depositPerUnit",
  "totalPrice",
  "combinationKey",
  "selectedAttributes",
  "taxRate",
  "taxAmount",
  "priceExclTax",
  "totalExclTax",
] as const;

type ReservationKey = (typeof PENDING_CHECKOUT_RESERVATION_KEYS)[number];
type ItemKey = (typeof PENDING_CHECKOUT_ITEM_KEYS)[number];

export type PendingCheckoutReservation = Partial<Record<ReservationKey, unknown>>;
export type PendingCheckoutItem = Partial<Record<ItemKey, unknown>>;

export interface PendingCheckoutSnapshot {
  reservation: PendingCheckoutReservation;
  items: PendingCheckoutItem[];
}

const NUMERIC_STRING = /^-?\d+(?:\.\d+)?$/;
const NUMERIC_PRECISION = 1e6;

/**
 * Same value whether it comes from the write payload or from the database:
 * decimals are strings of varying scale, dates are Date objects, JSON columns
 * are plain objects, absent optionals are `undefined` on one side and `null`
 * on the other.
 */
const canonicalize = (value: unknown): unknown => {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Math.round(value * NUMERIC_PRECISION) / NUMERIC_PRECISION;
  if (typeof value === "string") {
    return NUMERIC_STRING.test(value) ? canonicalize(Number(value)) : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
};

const serialize = <TKey extends string>(
  record: Partial<Record<TKey, unknown>>,
  keys: readonly TKey[],
): string => JSON.stringify(keys.map((key) => canonicalize(record[key])));

const serializeItems = (items: PendingCheckoutItem[]): string[] =>
  items.map((item) => serialize(item, PENDING_CHECKOUT_ITEM_KEYS)).sort();

/** True when both snapshots describe the same booking, line order aside. */
export const isSamePendingCheckout = (
  existing: PendingCheckoutSnapshot,
  candidate: PendingCheckoutSnapshot,
): boolean => {
  if (
    serialize(existing.reservation, PENDING_CHECKOUT_RESERVATION_KEYS) !==
    serialize(candidate.reservation, PENDING_CHECKOUT_RESERVATION_KEYS)
  ) {
    return false;
  }

  const existingItems = serializeItems(existing.items);
  const candidateItems = serializeItems(candidate.items);
  return (
    existingItems.length === candidateItems.length &&
    existingItems.every((item, index) => item === candidateItems[index])
  );
};
