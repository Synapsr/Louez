import { and, count, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from './index';
import type { SQL, SQLWrapper } from 'drizzle-orm';
import { productUnits, products } from './schema';

export function activeProductUnitCountSql(
  productId: SQLWrapper = products.id,
): SQL<number> {
  return sql<number>`(
    select count(*)
    from ${productUnits}
    where ${productUnits.productId} = ${productId}
      and ${productUnits.lifecycleStatus} = 'active'
  )`;
}

export function effectiveProductQuantitySql(params?: {
  productId?: SQLWrapper;
  trackUnits?: SQLWrapper;
  quantity?: SQLWrapper;
}): SQL<number> {
  return sql<number>`case
    when ${params?.trackUnits ?? products.trackUnits}
      then ${activeProductUnitCountSql(params?.productId ?? products.id)}
    else ${params?.quantity ?? products.quantity}
  end`;
}

export async function getEffectiveProductQuantities(
  database: Pick<Database, 'select'>,
  productIds: string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) {
    return new Map();
  }

  const rows = await database
    .select({
      productId: productUnits.productId,
      quantity: count(),
    })
    .from(productUnits)
    .where(
      and(
        inArray(productUnits.productId, productIds),
        eq(productUnits.lifecycleStatus, 'active'),
      ),
    )
    .groupBy(productUnits.productId);

  return new Map(rows.map((row) => [row.productId, row.quantity]));
}
