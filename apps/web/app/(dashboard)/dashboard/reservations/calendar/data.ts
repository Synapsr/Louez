import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db, effectiveProductQuantitySql } from "@louez/db";
import { productUnits, products, reservations } from "@louez/db";

/** Whether the store has ever created a reservation, regardless of date or status. */
export async function getStoreHasReservations(storeId: string) {
  const [reservation] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(eq(reservations.storeId, storeId))
    .limit(1);

  return reservation !== undefined;
}

/**
 * Active products with their effective quantity and — for unit-tracked
 * products — their active units, so the planning can render one row per unit.
 */
export async function getCalendarProducts(storeId: string) {
  const [rows, unitRows] = await Promise.all([
    // Only select columns needed for the calendar to avoid MySQL sort memory issues
    db
      .select({
        id: products.id,
        name: products.name,
        quantity: effectiveProductQuantitySql(),
        // Thumbnail for the product filter combobox
        images: products.images,
        trackUnits: products.trackUnits,
      })
      .from(products)
      .where(and(eq(products.storeId, storeId), eq(products.status, "active")))
      // Storefront catalog order, with a predictable alphabetical fallback for
      // stores that never configured displayOrder — same order as the product
      // pickers on the new/edit reservation pages
      .orderBy(asc(products.displayOrder), asc(products.name)),
    db
      .select({
        id: productUnits.id,
        productId: productUnits.productId,
        identifier: productUnits.identifier,
      })
      .from(productUnits)
      .innerJoin(products, eq(productUnits.productId, products.id))
      .where(
        and(
          eq(products.storeId, storeId),
          eq(products.status, "active"),
          eq(products.trackUnits, true),
          eq(productUnits.lifecycleStatus, "active"),
        ),
      )
      .orderBy(asc(productUnits.identifier)),
  ]);

  const unitsByProduct = new Map<string, { id: string; identifier: string }[]>();
  for (const unit of unitRows) {
    const list = unitsByProduct.get(unit.productId) ?? [];
    list.push({ id: unit.id, identifier: unit.identifier });
    unitsByProduct.set(unit.productId, list);
  }

  return rows.map((product) => ({
    ...product,
    units: unitsByProduct.get(product.id) ?? [],
  }));
}
