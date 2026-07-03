import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import 'server-only';

import { db, productUnitDowntimes } from '@louez/db';

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
        lte(productUnitDowntimes.startsAt, now),
        or(
          isNull(productUnitDowntimes.endsAt),
          gt(productUnitDowntimes.endsAt, now),
        ),
      ),
    );

  return new Set(rows.map((row) => row.productUnitId));
}
