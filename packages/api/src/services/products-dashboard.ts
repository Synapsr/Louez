import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';

import {
  categories,
  db,
  effectiveProductQuantitySql,
  productCategories,
  products,
} from '@louez/db';

export const DASHBOARD_PRODUCT_STATUSES = [
  'active',
  'draft',
  'archived',
] as const;

export type DashboardProductStatus = (typeof DASHBOARD_PRODUCT_STATUSES)[number];

export interface DashboardProductsListParams {
  storeId: string;
  status?: 'all' | DashboardProductStatus;
  /**
   * Empty (or omitted) means "all categories". Several ids are OR'd together:
   * a product is kept when it belongs to *any* of the selected categories.
   */
  categoryIds?: string[];
  limit?: number;
}

export async function getDashboardProductsList({
  storeId,
  status,
  categoryIds,
  limit = 100,
}: DashboardProductsListParams) {
  // Scope = store + categories. Status is applied on top of it for the table,
  // but not for the counts, so the tabs keep showing how many products each
  // status holds within the current category selection.
  const scopeConditions = [eq(products.storeId, storeId)];

  const selectedCategoryIds = categoryIds?.filter(Boolean) ?? [];
  if (selectedCategoryIds.length > 0) {
    scopeConditions.push(
      inArray(
        products.id,
        db
          .select({ id: productCategories.productId })
          .from(productCategories)
          .where(inArray(productCategories.categoryId, selectedCategoryIds)),
      ),
    );
  }

  const conditions = [...scopeConditions];
  if (status && status !== 'all') {
    conditions.push(eq(products.status, status));
  }

  const [productIds, statusCounts] = await Promise.all([
    // Step 1: ids only (excludes images to avoid a sort buffer overflow).
    // Order by displayOrder first (manual sorting), then createdAt for new ones.
    db
      .select({ id: products.id })
      .from(products)
      .where(and(...conditions))
      .orderBy(asc(products.displayOrder), desc(products.createdAt))
      .limit(limit),
    db
      .select({ status: products.status, count: count() })
      .from(products)
      .where(and(...scopeConditions))
      .groupBy(products.status),
  ]);

  const counts = { all: 0, active: 0, draft: 0, archived: 0 };
  for (const row of statusCounts) {
    counts.all += row.count;
    if (row.status) {
      counts[row.status] = row.count;
    }
  }

  if (productIds.length === 0) {
    return { products: [], counts };
  }

  // Step 2: full rows for those products only (no ORDER BY, small result set)
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      images: products.images,
      price: products.price,
      deposit: products.deposit,
      quantity: effectiveProductQuantitySql(),
      stockKind: products.stockKind,
      status: products.status,
      categoryId: products.categoryId,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(
      inArray(
        products.id,
        productIds.map((product) => product.id),
      ),
    );

  const rowsById = new Map(rows.map((row) => [row.id, row]));

  return {
    // Preserve the order from the first query
    products: productIds
      .map(({ id }) => rowsById.get(id))
      .filter((row): row is NonNullable<typeof row> => row !== undefined)
      .map((row) => ({
        id: row.id,
        name: row.name,
        images: row.images,
        price: row.price,
        deposit: row.deposit,
        quantity: row.quantity,
        stockKind: row.stockKind,
        status: row.status,
        category:
          row.categoryId && row.categoryName
            ? { id: row.categoryId, name: row.categoryName }
            : null,
      })),
    counts,
  };
}

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

export type DashboardProductsList = Awaited<
  ReturnType<typeof getDashboardProductsList>
>;
