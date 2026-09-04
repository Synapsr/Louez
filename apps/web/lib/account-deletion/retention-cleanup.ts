import 'server-only';

import { db, legalRetentionRecords } from '@louez/db';
import { lt } from 'drizzle-orm';

export const purgeExpiredLegalRetentionRecords = async (now = new Date()): Promise<number> => {
  const cutoff = now.toISOString().slice(0, 10);
  const result = await db
    .delete(legalRetentionRecords)
    .where(lt(legalRetentionRecords.retainUntil, cutoff));

  return result[0]?.affectedRows ?? 0;
};
