import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";

import { db, productUnitEvents, productUnits } from "@louez/db";

import { productErrors } from "../contracts/products";

const PRODUCT_ACTIVITY_PAGE_SIZE = 12;

export interface ProductUnitActivityItem {
  id: string;
  productUnitId: string | null;
  identifierSnapshot: string | null;
  type: string;
  actorUserId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProductUnitActivityPage {
  items: ProductUnitActivityItem[];
  /** The id of the page's last event; null on the last page. */
  nextCursor: string | null;
}

/**
 * One page of the unit events of a product, newest first. The cursor is the
 * id of the previous page's last event, read back in the store.
 */
export const getProductUnitActivityPage = async ({
  storeId,
  productId,
  cursor,
  limit = PRODUCT_ACTIVITY_PAGE_SIZE,
}: {
  storeId: string;
  productId: string;
  cursor?: string;
  limit?: number;
}): Promise<ProductUnitActivityPage> => {
  let cursorCondition: SQL | undefined;
  if (cursor) {
    const [after] = await db
      .select({ createdAt: productUnitEvents.createdAt, id: productUnitEvents.id })
      .from(productUnitEvents)
      .where(and(eq(productUnitEvents.id, cursor), eq(productUnitEvents.storeId, storeId)))
      .limit(1);
    if (!after) throw productErrors.invalidCursor("products_get_activity");
    cursorCondition = or(
      lt(productUnitEvents.createdAt, after.createdAt),
      and(eq(productUnitEvents.createdAt, after.createdAt), lt(productUnitEvents.id, after.id)),
    );
  }

  const rows = await db
    .select({
      id: productUnitEvents.id,
      productUnitId: productUnitEvents.productUnitId,
      identifierSnapshot: productUnitEvents.identifierSnapshot,
      type: productUnitEvents.type,
      actorUserId: productUnitEvents.actorUserId,
      payload: productUnitEvents.payload,
      createdAt: productUnitEvents.createdAt,
    })
    .from(productUnitEvents)
    .innerJoin(productUnits, eq(productUnitEvents.productUnitId, productUnits.id))
    .where(
      and(
        eq(productUnitEvents.storeId, storeId),
        eq(productUnits.productId, productId),
        cursorCondition,
      ),
    )
    .orderBy(desc(productUnitEvents.createdAt), desc(productUnitEvents.id))
    .limit(limit + 1);

  const hasNextPage = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const items = pageRows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
  const lastItem = items.at(-1);

  return { items, nextCursor: hasNextPage && lastItem ? lastItem.id : null };
};
