import type { PricingBreakdown } from "@louez/types";

/**
 * An edit of a reservation is computed from a plain read, then written under
 * the locks. These helpers say whether what was read still holds once the
 * locks are taken, and which products the edit asks more stock of.
 */

interface EditedReservation {
  status: string;
  startDate: Date;
  endDate: Date;
  subtotalAmount: string;
  depositAmount: string;
  totalAmount: string;
  deliveryFee: string | null;
  discountAmount: string | null;
  tulipInsuranceOptIn: boolean | null;
  tulipInsuranceAmount: string | null;
}

interface EditedReservationItem {
  id: string;
  productId: string | null;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  depositPerUnit: string;
  pricingBreakdown: PricingBreakdown | null;
}

/**
 * A decimal column as two digits: a relation read gives "10", a select "10.00".
 */
const money = (value: string | null): string | null =>
  value === null ? null : Number.parseFloat(value).toFixed(2);

/**
 * Everything an edit's totals and item writes are computed from, as one
 * string: two reads that give the same string give the same edit.
 */
export const fingerprintReservationEdit = (
  reservation: EditedReservation,
  items: readonly EditedReservationItem[],
): string =>
  JSON.stringify([
    reservation.status,
    reservation.startDate.getTime(),
    reservation.endDate.getTime(),
    money(reservation.subtotalAmount),
    money(reservation.depositAmount),
    money(reservation.totalAmount),
    money(reservation.deliveryFee),
    money(reservation.discountAmount),
    reservation.tulipInsuranceOptIn,
    money(reservation.tulipInsuranceAmount),
    [...items]
      .sort((a, b) => a.id.localeCompare(b.id, "en"))
      .map((item) => [
        item.id,
        item.productId,
        item.quantity,
        money(item.unitPrice),
        money(item.totalPrice),
        money(item.depositPerUnit),
        item.pricingBreakdown,
      ]),
  ]);

interface ReservationDemand {
  start: Date;
  end: Date;
  lines: ReadonlyArray<{ productId: string | null; quantity: number }>;
}

const quantityByProduct = (lines: ReservationDemand["lines"]): Map<string, number> => {
  const quantities = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId) continue;
    quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
  }
  return quantities;
};

/**
 * What an edit changes in the stock a reservation asks for. `changed`: its
 * window or a product's quantity moved, either way. `raisedProductIds`: the
 * products it asks more of, which is every product once the window reaches
 * outside the previous one, and else those whose quantity grows. A shorter
 * window or a lower quantity never asks for more.
 */
export const compareReservationDemand = (
  previous: ReservationDemand,
  next: ReservationDemand,
): { changed: boolean; raisedProductIds: Set<string> } => {
  const before = quantityByProduct(previous.lines);
  const after = quantityByProduct(next.lines);
  const windowChanged =
    next.start.getTime() !== previous.start.getTime() ||
    next.end.getTime() !== previous.end.getTime();
  const windowExtended =
    next.start.getTime() < previous.start.getTime() || next.end.getTime() > previous.end.getTime();

  const raisedProductIds = new Set<string>();
  for (const [productId, quantity] of after) {
    if (windowExtended || quantity > (before.get(productId) ?? 0)) raisedProductIds.add(productId);
  }
  const quantitiesChanged =
    before.size !== after.size ||
    [...after].some(([productId, quantity]) => before.get(productId) !== quantity);

  return { changed: windowChanged || quantitiesChanged, raisedProductIds };
};
