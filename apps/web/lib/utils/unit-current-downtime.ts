import { and, eq, inArray } from 'drizzle-orm';
import 'server-only';

import {
  buildUnitInDowntimeAtPredicate,
  db,
  productUnitDowntimes,
} from '@louez/db';

export async function getCurrentDowntimeUnitIds(
  unitIds: string[],
  storeId: string,
  now = new Date(),
): Promise<Set<string>> {
  if (unitIds.length === 0) {
    return new Set();
  }

  const rows = await db
    .select({ productUnitId: productUnitDowntimes.productUnitId })
    .from(productUnitDowntimes)
    .where(
      and(
        eq(productUnitDowntimes.storeId, storeId),
        inArray(productUnitDowntimes.productUnitId, unitIds),
        buildUnitInDowntimeAtPredicate(now),
      ),
    );

  return new Set(rows.map((row) => row.productUnitId));
}
