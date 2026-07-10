import type { AdvisorValidatedCart } from '@louez/types';

interface CartForValidation {
  items: { productId: string; quantity: number }[];
  startDate: string | null;
  endDate: string | null;
}

function isSameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const timeA = Date.parse(a);
  const timeB = Date.parse(b);
  return !Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA === timeB;
}

function quantitiesByProduct(
  items: { productId: string; quantity: number }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
  }
  return map;
}

/**
 * Whether an advisor validation still covers a cart: exact same rental
 * period and exact same per-product quantities. Used by BOTH the checkout
 * gate UI and the server enforcement in createReservation — keep them in
 * sync by construction.
 */
export function advisorValidationCovers(
  validatedCart: AdvisorValidatedCart | null | undefined,
  cart: CartForValidation,
): boolean {
  if (!validatedCart || cart.items.length === 0) return false;

  if (
    !isSameInstant(validatedCart.startDate, cart.startDate) ||
    !isSameInstant(validatedCart.endDate, cart.endDate)
  ) {
    return false;
  }

  const validated = quantitiesByProduct(validatedCart.items);
  const current = quantitiesByProduct(cart.items);
  if (validated.size !== current.size) return false;
  for (const [productId, quantity] of current) {
    if (validated.get(productId) !== quantity) return false;
  }
  return true;
}
