import { db, pageViews, storeVisibilitySteps } from "@louez/db";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";

import {
  VISIBILITY_STEP_KEYS,
  VISIBILITY_VISITS_WINDOW_DAYS,
  parseVisitSource,
  type VisibilityStep,
  type VisibilityStepKey,
  type VisibilityStepStatus,
  type VisibilityView,
  type VisitSource,
} from "../contracts/visibility";

/**
 * The "Se faire connaître" guide (docs/product/visibilite-boutiques.md): which
 * steps the store has decided, and the visits its marked links brought.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type StepRow = { step: string; status: "done" | "skipped"; decidedAt: Date };

/** Every step in the guide's order; one without a row is still to do. */
export function toVisibilitySteps(rows: readonly StepRow[]): VisibilityStep[] {
  return VISIBILITY_STEP_KEYS.map((key) => {
    const row = rows.find((candidate) => candidate.step === key);
    return row
      ? { key, status: row.status, decidedAt: row.decidedAt }
      : { key, status: "todo", decidedAt: null };
  });
}

/**
 * Visits per source, the most first. A visit is a storefront session; one
 * whose pages carry two sources (a link reshared) counts once for each.
 * Values outside `VISIT_SOURCES` (an older list) are dropped.
 */
export function toVisitsBySource(
  rows: readonly { source: string | null; visits: number | string }[],
): VisibilityView["visits"] {
  const bySource = rows
    .map((row) => ({ source: parseVisitSource(row.source), visits: Number(row.visits) || 0 }))
    .filter(
      (row): row is { source: VisitSource; visits: number } => row.source !== null && row.visits > 0,
    )
    .sort((a, b) => b.visits - a.visits);
  return { total: bySource.reduce((sum, row) => sum + row.visits, 0), bySource };
}

export async function getVisibility(
  storeId: string,
  now: Date = new Date(),
): Promise<VisibilityView> {
  const since = new Date(now.getTime() - VISIBILITY_VISITS_WINDOW_DAYS * DAY_MS);
  const [stepRows, visitRows] = await Promise.all([
    db
      .select({
        step: storeVisibilitySteps.step,
        status: storeVisibilitySteps.status,
        decidedAt: storeVisibilitySteps.decidedAt,
      })
      .from(storeVisibilitySteps)
      .where(eq(storeVisibilitySteps.storeId, storeId)),
    db
      .select({
        source: pageViews.source,
        visits: sql<number>`COUNT(DISTINCT ${pageViews.sessionId})`,
      })
      .from(pageViews)
      .where(
        and(
          eq(pageViews.storeId, storeId),
          isNotNull(pageViews.source),
          gte(pageViews.createdAt, since),
        ),
      )
      .groupBy(pageViews.source),
  ]);

  return { steps: toVisibilitySteps(stepRows), visits: toVisitsBySource(visitRows) };
}

/** Marks a step done or skipped, or reopens it (`todo`). Idempotent. */
export async function setVisibilityStep(input: {
  storeId: string;
  userId: string;
  step: VisibilityStepKey;
  status: VisibilityStepStatus;
}): Promise<VisibilityStep> {
  const where = and(
    eq(storeVisibilitySteps.storeId, input.storeId),
    eq(storeVisibilitySteps.step, input.step),
  );

  if (input.status === "todo") {
    await db.delete(storeVisibilitySteps).where(where);
    return { key: input.step, status: "todo", decidedAt: null };
  }

  const decidedAt = new Date();
  const values = { status: input.status, userId: input.userId, decidedAt };
  await db
    .insert(storeVisibilitySteps)
    .values({ storeId: input.storeId, step: input.step, ...values })
    .onDuplicateKeyUpdate({ set: values });
  return { key: input.step, status: input.status, decidedAt };
}
