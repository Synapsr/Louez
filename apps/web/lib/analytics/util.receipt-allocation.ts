const ZERO = BigInt(0);
const ONE = BigInt(1);

export interface AllocationItem {
  id: string;
  /** The item's price, in cents: its weight in the split. */
  weightCents: number;
}

/**
 * Splits a receipt's cents across its reservation's items in proportion to their
 * price, in whole cents that sum to the receipt. Each item gets the floor of its
 * exact share; the cents left go one each to the largest remainders, ties going to
 * the larger share, then to the smaller id. Items without a price get nothing, and
 * a reservation whose items are all free allocates nothing.
 */
export function allocateReceiptCents(
  amountCents: number,
  items: readonly AllocationItem[],
): Map<string, number> {
  const weighted = items.filter((item) => item.weightCents > 0);
  const totalWeight = weighted.reduce((sum, item) => sum + BigInt(item.weightCents), ZERO);
  const allocation = new Map<string, number>();
  if (totalWeight === ZERO || amountCents <= 0) return allocation;

  const amount = BigInt(amountCents);
  const shares = weighted.map((item) => {
    const exact = amount * BigInt(item.weightCents);
    return { item, floor: exact / totalWeight, remainder: exact % totalWeight };
  });
  let left = amount - shares.reduce((sum, share) => sum + share.floor, ZERO);
  const order = [...shares].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.item.weightCents !== b.item.weightCents) return b.item.weightCents - a.item.weightCents;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });
  for (const share of order) {
    if (left === ZERO) break;
    share.floor += ONE;
    left -= ONE;
  }
  for (const share of shares) allocation.set(share.item.id, Number(share.floor));
  return allocation;
}

/** A decimal amount as stored ("12.34"), in cents. */
export const toCents = (amount: string | number | null | undefined): number =>
  Math.round(Number(amount ?? 0) * 100);
