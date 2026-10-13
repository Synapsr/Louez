import type { StockKind, UnitAttributes } from "@louez/types";

export interface CartDemandLine {
  productId: string;
  quantity: number;
  startDate: string;
  endDate: string;
  selectedAttributes?: UnitAttributes;
}

function rentalWindowsOverlap(left: CartDemandLine, right: CartDemandLine): boolean {
  const leftStart = Date.parse(left.startDate);
  const leftEnd = Date.parse(left.endDate);
  const rightStart = Date.parse(right.startDate);
  const rightEnd = Date.parse(right.endDate);
  return (
    Number.isFinite(leftStart) &&
    Number.isFinite(leftEnd) &&
    Number.isFinite(rightStart) &&
    Number.isFinite(rightEnd) &&
    leftStart < rightEnd &&
    rightStart < leftEnd
  );
}

function hasSameSelection(
  left: UnitAttributes | undefined,
  right: UnitAttributes | undefined,
): boolean {
  const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value], index) =>
        key === rightEntries[index]?.[0] && value === rightEntries[index]?.[1],
    )
  );
}

/** Total demand competing for the same stock pool as one cart line. */
export function getCartRequestedQuantity(
  lines: CartDemandLine[],
  line: CartDemandLine,
  stockKind: StockKind,
): number {
  return lines.reduce((quantity, candidate) => {
    if (candidate.productId !== line.productId) {
      return quantity;
    }

    const sharesStock =
      stockKind === "consumable" ||
      (rentalWindowsOverlap(candidate, line) &&
        hasSameSelection(candidate.selectedAttributes, line.selectedAttributes));

    return sharesStock ? quantity + candidate.quantity : quantity;
  }, 0);
}
