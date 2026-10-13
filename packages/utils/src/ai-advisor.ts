import type { AdvisorValidatedCart } from '@louez/types';

interface CartForValidation {
  items: {
    productId: string;
    quantity: number;
    startDate?: string;
    endDate?: string;
  }[];
  startDate: string | null;
  endDate: string | null;
}

function quantitiesByProductAndPeriod(
  items: CartForValidation['items'],
  fallbackStartDate: string | null,
  fallbackEndDate: string | null,
): Map<string, number> | null {
  const map = new Map<string, number>();
  for (const item of items) {
    const startDate = item.startDate ?? fallbackStartDate;
    const endDate = item.endDate ?? fallbackEndDate;
    if (!startDate || !endDate) return null;
    const start = Date.parse(startDate);
    const end = Date.parse(endDate);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const key = `${item.productId}:${start}:${end}`;
    map.set(key, (map.get(key) ?? 0) + item.quantity);
  }
  return map;
}

/**
 * Whether an advisor validation still covers a cart: exact same period per
 * product line and exact quantities. Used by BOTH the checkout
 * gate UI and the server enforcement in createReservation — keep them in
 * sync by construction.
 */
export function advisorValidationCovers(
  validatedCart: AdvisorValidatedCart | null | undefined,
  cart: CartForValidation,
): boolean {
  if (!validatedCart || cart.items.length === 0) return false;

  const validated = quantitiesByProductAndPeriod(
    validatedCart.items,
    validatedCart.startDate,
    validatedCart.endDate,
  );
  const current = quantitiesByProductAndPeriod(cart.items, cart.startDate, cart.endDate);
  if (!validated || !current) return false;
  if (validated.size !== current.size) return false;
  for (const [productId, quantity] of current) {
    if (validated.get(productId) !== quantity) return false;
  }
  return true;
}
