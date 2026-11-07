import { PRODUCT_LIST_LIMITS, type ProductListName } from "@louez/validations";

/**
 * How many items a product's list may still take, by the limits the API
 * holds it to (`PRODUCT_LIST_LIMITS`). Zero when the list is full or, for a
 * product stored before a limit existed, over it.
 */
export function remainingListSlots(list: ProductListName, current: number): number {
  return Math.max(0, PRODUCT_LIST_LIMITS[list] - current);
}
