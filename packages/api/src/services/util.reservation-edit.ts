import type { BookingAttributeAxis, PricingBreakdown, UnitAttributes } from "@louez/types";
import { canonicalizeAttributes, isPooledCombinationKey } from "@louez/utils";

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
  lines: ReadonlyArray<{
    productId: string | null;
    quantity: number;
    combinationKey?: string | null;
    selectedAttributes?: UnitAttributes | null;
  }>;
}

type DemandLine = ReservationDemand["lines"][number];

type ProductAxes = BookingAttributeAxis[] | null | undefined;

/**
 * What a line chose of its product, as the stock check reads it: its exact
 * combination, or, for a line that any matching unit serves, the attributes
 * it chose among the product's current axes. A value kept from an axis the
 * product dropped since is no choice any more.
 */
const choiceOf = (line: DemandLine, axes: ProductAxes): string => {
  const exactCombination =
    line.combinationKey && !isPooledCombinationKey(axes, line.combinationKey)
      ? line.combinationKey
      : null;
  return JSON.stringify([
    exactCombination,
    exactCombination
      ? []
      : Object.entries(canonicalizeAttributes(axes, line.selectedAttributes)).sort(([a], [b]) =>
          a.localeCompare(b, "en"),
        ),
  ]);
};

const sumQuantities = (
  lines: ReservationDemand["lines"],
  keyOf: (line: DemandLine & { productId: string }) => string,
): Map<string, number> => {
  const quantities = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId) continue;
    const key = keyOf({ ...line, productId: line.productId });
    quantities.set(key, (quantities.get(key) ?? 0) + line.quantity);
  }
  return quantities;
};

const sameQuantities = (a: Map<string, number>, b: Map<string, number>): boolean =>
  a.size === b.size && [...a].every(([key, quantity]) => b.get(key) === quantity);

/**
 * What an edit changes in the stock a reservation asks for, counted per
 * product and per choice within it (a size, a combination), as units of one
 * size do not serve a line that chose another. `changed`: its window or a
 * quantity moved, either way. `raisedProductIds`: the products it asks more
 * of, which is every product once the window reaches outside the previous
 * one, and else those of which it asks more in all or more of one choice: two
 * units moved from size S to size L ask more of L. A shorter window or a lower
 * quantity never asks for more. `axesOf` gives a product's current axes, the
 * ones the stock check matches on.
 */
export const compareReservationDemand = (
  previous: ReservationDemand,
  next: ReservationDemand,
  axesOf: (productId: string) => ProductAxes,
): { changed: boolean; raisedProductIds: Set<string> } => {
  const windowChanged =
    next.start.getTime() !== previous.start.getTime() ||
    next.end.getTime() !== previous.end.getTime();
  const windowExtended =
    next.start.getTime() < previous.start.getTime() || next.end.getTime() > previous.end.getTime();

  const byProduct = (line: { productId: string }) => line.productId;
  // The product id is repeated in front of the choice, so two products never share a key.
  const byChoice = (line: DemandLine & { productId: string }) =>
    JSON.stringify([line.productId, choiceOf(line, axesOf(line.productId))]);
  const productOfChoice = (key: string): string => (JSON.parse(key) as [string, string])[0];

  const before = sumQuantities(previous.lines, byProduct);
  const after = sumQuantities(next.lines, byProduct);
  const choicesBefore = sumQuantities(previous.lines, byChoice);
  const choicesAfter = sumQuantities(next.lines, byChoice);

  const raisedProductIds = new Set<string>();
  for (const [productId, quantity] of after) {
    if (windowExtended || quantity > (before.get(productId) ?? 0)) raisedProductIds.add(productId);
  }
  for (const [choice, quantity] of choicesAfter) {
    if (quantity > (choicesBefore.get(choice) ?? 0)) raisedProductIds.add(productOfChoice(choice));
  }

  return {
    changed: windowChanged || !sameQuantities(choicesBefore, choicesAfter),
    raisedProductIds,
  };
};
