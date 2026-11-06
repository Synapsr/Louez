import "server-only";

import { processCustomerImportChunk } from "@louez/api/services/customer-import";
import { processProductImportChunk } from "@louez/api/services/product-import";
import { db, importRows, importRuns, stores } from "@louez/db";
import { and, eq, lt } from "drizzle-orm";

import { getStoreLimits } from "@/lib/plan-limits";

/** A running import nobody has moved for this long has lost its browser tab. */
const STALLED_AFTER_MS = 2 * 60_000;
/** Staged rows hold customers' data: they go once the undo window is over. */
const STAGED_ROWS_RETENTION_MS = 30 * 24 * 60 * 60_000;
const MAX_RUNS_PER_TICK = 5;

/**
 * Carries on the imports whose wizard was closed, one chunk each per tick, and
 * purges the staged rows of old imports. The wizard and this queue may meet on
 * the same run: the service's per-run lock lets only one of them work.
 */
export async function processImportQueue() {
  const stalled = await db
    .select({
      id: importRuns.id,
      storeId: importRuns.storeId,
      entityType: importRuns.entityType,
      settings: stores.settings,
    })
    .from(importRuns)
    .innerJoin(stores, eq(stores.id, importRuns.storeId))
    .where(
      and(
        eq(importRuns.status, "running"),
        lt(importRuns.updatedAt, new Date(Date.now() - STALLED_AFTER_MS)),
      ),
    )
    .limit(MAX_RUNS_PER_TICK);

  for (const run of stalled) {
    const limits = await getStoreLimits(run.storeId);
    if (run.entityType === "products") {
      await processProductImportChunk({
        storeId: run.storeId,
        runId: run.id,
        remainingQuota: limits.products.remaining,
      });
      continue;
    }
    await processCustomerImportChunk({
      storeId: run.storeId,
      runId: run.id,
      defaultCountry: run.settings?.country ?? "FR",
      remainingQuota: limits.customers.remaining,
    });
  }

  const expired = await db
    .select({ id: importRuns.id })
    .from(importRuns)
    .where(lt(importRuns.createdAt, new Date(Date.now() - STAGED_ROWS_RETENTION_MS)))
    .limit(50);
  for (const run of expired) {
    await db.delete(importRows).where(eq(importRows.runId, run.id));
  }

  return { resumed: stalled.length, purged: expired.length };
}
