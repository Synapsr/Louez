import { and, asc, desc, eq, ne } from 'drizzle-orm';

import { db, products } from '@louez/db';

export interface AccessoryCandidatesParams {
  storeId: string;
  /** The product being edited never shows up in its own accessory list. */
  excludeProductId?: string;
}

/**
 * Products a merchant can attach as accessories. Ordered like the dashboard
 * list and the storefront catalog, so the picker shows the shop in the order
 * the merchant arranged it.
 */
export async function getAccessoryCandidates({
  storeId,
  excludeProductId,
}: AccessoryCandidatesParams) {
  const conditions = [
    eq(products.storeId, storeId),
    eq(products.status, 'active'),
  ];
  if (excludeProductId) {
    conditions.push(ne(products.id, excludeProductId));
  }

  return db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      images: products.images,
    })
    .from(products)
    .where(and(...conditions))
    .orderBy(asc(products.displayOrder), desc(products.createdAt));
}

export type AccessoryCandidate = Awaited<
  ReturnType<typeof getAccessoryCandidates>
>[number];
