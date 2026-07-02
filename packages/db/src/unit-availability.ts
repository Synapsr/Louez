import { and, eq, gt, isNull, lt, notExists, or } from 'drizzle-orm';

import type { Database } from './index';
import { productUnitDowntimes, productUnits } from './schema';

export function buildUnitRentableDuringPredicate(
  database: Pick<Database, 'select'>,
  startDate: Date,
  endDate: Date,
) {
  return and(
    eq(productUnits.lifecycleStatus, 'active'),
    notExists(
      database
        .select({ id: productUnitDowntimes.id })
        .from(productUnitDowntimes)
        .where(
          and(
            eq(productUnitDowntimes.productUnitId, productUnits.id),
            lt(productUnitDowntimes.startsAt, endDate),
            or(
              isNull(productUnitDowntimes.endsAt),
              gt(productUnitDowntimes.endsAt, startDate),
            ),
          ),
        ),
    ),
  );
}
