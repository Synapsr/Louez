import { randomBytes } from "node:crypto";

import { apiJobs, db, type ApiJobError, type ApiJobKind, type Transaction } from "@louez/db";
import { and, asc, eq, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

/**
 * Background jobs of the agent-ready API (`api_jobs`): work a call starts
 * and that runs past it, such as an AI photo enhancement (2 to 6 minutes,
 * longer than an MCP client waits for a tool). The call queues the job in
 * its transaction and answers at once with its id; `jobs.get` reads it.
 *
 * - Once committed, the service hands the id to `ports.dispatchJobs`; the app
 *   runs it after the answer, a few at a time per process. The cron takes
 *   the jobs the first dispatch left (`dueJobIds`): queued past their grace
 *   or their retry's wait, and running past their lease (a restart, a
 *   deploy).
 * - A runner claims its job in a short transaction with a fresh token and a
 *   lease on the database's clock (`NOW(3)`), as the outbox does
 *   (platform/effects.ts). Only the token holder records the outcome: it
 *   locks the row and checks its token in the transaction that writes the
 *   result, so a runner whose claim was taken over writes nothing.
 * - A job runs at most `JOB_MAX_ATTEMPTS` times, takeovers included, and is
 *   retried only for a failure that may pass (a provider outage, a timeout,
 *   a crash). Past that it fails with `JOB_ABANDONED`.
 * - One active job per store and slot (`slot_key`, what the job works on):
 *   `active_slot` is 1 while it is queued or running, null once it ended.
 */

/** How long a runner holds a job before another may take it over. */
export const JOB_LEASE_MS = 8 * 60_000;
/** A runner is aborted at least this long before its lease ends. */
export const JOB_LEASE_MARGIN_MS = 60_000;
/** Runs of one job, takeovers included. */
export const JOB_MAX_ATTEMPTS = 2;
/** A queued job the first dispatch has not taken after this long is the cron's. */
export const JOB_PENDING_GRACE_MS = 60_000;
/** The wait before a failed run is tried again. */
export const JOB_RETRY_DELAY_MS = 60_000;
/** How long an ended job is kept. */
export const JOB_RETENTION_MS = 90 * 86_400_000;

export type JobRow = typeof apiJobs.$inferSelect;

/** The database's time `ms` from now (negative: ago). App clocks never date a row. */
const dbNowPlus = (ms: number) => sql`TIMESTAMPADD(MICROSECOND, ${Math.round(ms * 1000)}, NOW(3))`;

/** What a new job holds: what it does, on what, and who started it. */
export interface NewJob {
  storeId: string;
  kind: ApiJobKind;
  targetId: string;
  slotKey: string;
  input: Record<string, unknown>;
  operationId: string | null;
  userId: string;
  credentialKind: string;
  credentialId: string | null;
  clientName: string | null;
}

/**
 * Queues a job in the write's transaction; returns its id, for
 * `ports.dispatchJobs` once committed. The cron leaves it to the first
 * dispatch for `JOB_PENDING_GRACE_MS`.
 */
export async function queueJob(tx: Transaction, job: NewJob, id: string = nanoid()) {
  await tx.insert(apiJobs).values({
    id,
    ...job,
    activeSlot: 1,
    nextAttemptAt: dbNowPlus(JOB_PENDING_GRACE_MS),
    // To the millisecond (the column's default has whole seconds): a job started
    // again on the same photo comes after the one that failed.
    createdAt: sql`NOW(3)`,
    updatedAt: sql`NOW(3)`,
  });
  return id;
}

/** The store's active job on a slot, locked; null when none runs there. */
export async function lockActiveJob(tx: Transaction, storeId: string, slotKey: string) {
  const [row] = await tx
    .select()
    .from(apiJobs)
    .where(
      and(eq(apiJobs.storeId, storeId), eq(apiJobs.slotKey, slotKey), eq(apiJobs.activeSlot, 1)),
    )
    .for("update");
  return row ?? null;
}

/** How many jobs of these kinds the store has queued or running. */
export async function countActiveJobs(
  tx: Transaction,
  storeId: string,
  kinds: readonly ApiJobKind[],
) {
  const [row] = await tx
    .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(apiJobs)
    .where(
      and(
        eq(apiJobs.storeId, storeId),
        eq(apiJobs.activeSlot, 1),
        inArray(apiJobs.kind, [...kinds]),
      ),
    );
  return row?.count ?? 0;
}

/** A store's job, or null. */
export async function readJob(storeId: string, id: string): Promise<JobRow | null> {
  const [row] = await db
    .select()
    .from(apiJobs)
    .where(and(eq(apiJobs.id, id), eq(apiJobs.storeId, storeId)));
  return row ?? null;
}

/** A job a runner holds. */
export interface ClaimedJob {
  job: JobRow;
  token: string;
  /**
   * `performance.now()` just before the database's clock was read for the
   * lease: the runner's time is counted from here, so the claim's own time
   * is spent from the lease, never added to it.
   */
  grantedAt: number;
}

export type ClaimOutcome =
  | ({ kind: "claimed" } & ClaimedJob)
  /** Past its last attempt: failed now with `JOB_ABANDONED`; the caller cleans up after it. */
  | { kind: "abandoned"; job: JobRow }
  | null;

const ABANDONED: ApiJobError = {
  code: "JOB_ABANDONED",
  message: "The job stopped before it finished, too many times. Nothing was charged.",
  retryable: true,
};

/**
 * Takes a job for running, in a short transaction: a queued one whose time
 * has come, or a running one whose runner's lease ran out, under the attempt
 * ceiling. Null when the job is not this runner's to run now.
 *
 * Every decision uses the database's time, read once the row is locked.
 */
export async function claimJob(id: string, leaseMs: number = JOB_LEASE_MS): Promise<ClaimOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(apiJobs).where(eq(apiJobs.id, id)).for("update");
    if (!row) return null;
    const grantedAt = performance.now();
    // MySQL fixes NOW() when a statement starts: read it in a statement of its
    // own, now that the row is locked.
    const [clock] = await tx
      .select({
        now: sql<string>`DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s.%f')`,
        leaseOver: sql<number | null>`${apiJobs.lockedUntil} < NOW(3)`,
        due: sql<number>`${apiJobs.nextAttemptAt} <= NOW(3)`,
      })
      .from(apiJobs)
      .where(eq(apiJobs.id, id));
    if (!clock) return null;

    const takeable =
      (row.status === "queued" && Number(clock.due) === 1) ||
      (row.status === "running" && Number(clock.leaseOver) === 1);
    // A dispatch right after the start runs a queued job at once: its grace
    // only keeps the cron away.
    const fresh = row.status === "queued" && row.attempts === 0;
    if (!takeable && !fresh) return null;

    if (row.attempts >= JOB_MAX_ATTEMPTS) {
      await tx
        .update(apiJobs)
        .set({
          status: "failed",
          error: ABANDONED,
          activeSlot: null,
          claimToken: null,
          lockedUntil: null,
          finishedAt: sql`NOW(3)`,
          updatedAt: sql`NOW(3)`,
        })
        .where(eq(apiJobs.id, id));
      return { kind: "abandoned", job: { ...row, status: "failed", error: ABANDONED } };
    }

    const token = randomBytes(16).toString("hex");
    await tx
      .update(apiJobs)
      .set({
        status: "running",
        claimToken: token,
        lockedUntil: sql`TIMESTAMPADD(MICROSECOND, ${Math.round(leaseMs * 1000)}, ${clock.now})`,
        attempts: row.attempts + 1,
        startedAt: row.startedAt ?? sql`${clock.now}`,
        updatedAt: sql`${clock.now}`,
      })
      .where(eq(apiJobs.id, id));
    const [claimed] = await tx.select().from(apiJobs).where(eq(apiJobs.id, id));
    if (!claimed) return null;
    return { kind: "claimed", job: claimed, token, grantedAt };
  });
}

/**
 * In the transaction that records a job's outcome: locks the row and says
 * whether this runner still holds it (`held`), another one took it over or
 * ended it (`lost`), or the job is gone with its store (`gone`). Under that
 * lock no other runner can claim it, so a lease that ran out while no one
 * took over still counts.
 */
export async function lockClaimedJob(
  tx: Transaction,
  id: string,
  token: string,
): Promise<"held" | "lost" | "gone"> {
  const [row] = await tx
    .select({ status: apiJobs.status, claimToken: apiJobs.claimToken })
    .from(apiJobs)
    .where(eq(apiJobs.id, id))
    .for("update");
  if (!row) return "gone";
  return row.status === "running" && row.claimToken === token ? "held" : "lost";
}

const fenced = (id: string, token: string) =>
  and(eq(apiJobs.id, id), eq(apiJobs.status, "running"), eq(apiJobs.claimToken, token));

/** The job succeeded with `result`; in the transaction that wrote it, after `lockClaimedJob`. */
export async function completeJob(
  tx: Transaction,
  id: string,
  token: string,
  result: Record<string, unknown>,
) {
  await tx
    .update(apiJobs)
    .set({
      status: "succeeded",
      result,
      error: null,
      activeSlot: null,
      claimToken: null,
      lockedUntil: null,
      finishedAt: sql`NOW(3)`,
      updatedAt: sql`NOW(3)`,
    })
    .where(fenced(id, token));
}

/** The job failed for good; in a transaction that locked it with `lockClaimedJob`. */
export async function failJobInTransaction(
  tx: Transaction,
  id: string,
  token: string,
  error: ApiJobError,
) {
  await tx
    .update(apiJobs)
    .set({
      status: "failed",
      error,
      activeSlot: null,
      claimToken: null,
      lockedUntil: null,
      finishedAt: sql`NOW(3)`,
      updatedAt: sql`NOW(3)`,
    })
    .where(fenced(id, token));
}

/**
 * A run that failed: queued again after `JOB_RETRY_DELAY_MS` when the
 * failure may pass and the job has attempts left, failed for good otherwise.
 * Fenced by the claim: whether it wrote the failure (one row), which only
 * a runner that still held the job does. `executor`: a transaction that
 * locked the row first (`lockJob`).
 */
export async function recordJobFailure(
  claimed: ClaimedJob,
  error: ApiJobError,
  executor: Transaction | typeof db = db,
): Promise<boolean> {
  const retry = error.retryable && claimed.job.attempts < JOB_MAX_ATTEMPTS;
  const [result] = await executor
    .update(apiJobs)
    .set(
      retry
        ? {
            status: "queued",
            error,
            claimToken: null,
            lockedUntil: null,
            nextAttemptAt: dbNowPlus(JOB_RETRY_DELAY_MS),
            updatedAt: sql`NOW(3)`,
          }
        : {
            status: "failed",
            error,
            activeSlot: null,
            claimToken: null,
            lockedUntil: null,
            finishedAt: sql`NOW(3)`,
            updatedAt: sql`NOW(3)`,
          },
    )
    .where(fenced(claimed.job.id, claimed.token));
  return result.affectedRows === 1;
}

/**
 * A job's row, locked: the read waits for any transaction that holds it, so
 * what it returns is committed and stays so until `tx` ends. Null when the
 * job is gone.
 */
export async function lockJob(tx: Transaction, id: string): Promise<JobRow | null> {
  const [row] = await tx.select().from(apiJobs).where(eq(apiJobs.id, id)).for("update");
  return row ?? null;
}

/**
 * The cron's pass: the queued jobs whose grace or retry's wait is over, and
 * the running ones whose lease ran out, oldest first, in the database's time.
 */
export async function dueJobIds(limit = 20): Promise<string[]> {
  const now = sql`NOW(3)`;
  const due = await db
    .select({ id: apiJobs.id })
    .from(apiJobs)
    .where(
      or(
        and(eq(apiJobs.status, "queued"), lte(apiJobs.nextAttemptAt, now)),
        and(eq(apiJobs.status, "running"), lt(apiJobs.lockedUntil, now)),
      ),
    )
    .orderBy(asc(apiJobs.createdAt))
    .limit(limit);
  return due.map((row) => row.id);
}

/** Deletes the jobs that ended more than `JOB_RETENTION_MS` ago, oldest first. */
export async function pruneJobs(limit = 500) {
  const old = await db
    .select({ id: apiJobs.id })
    .from(apiJobs)
    .where(and(isNotNull(apiJobs.finishedAt), lt(apiJobs.finishedAt, dbNowPlus(-JOB_RETENTION_MS))))
    .orderBy(asc(apiJobs.finishedAt))
    .limit(limit);
  if (old.length === 0) return 0;
  await db.delete(apiJobs).where(
    inArray(
      apiJobs.id,
      old.map((row) => row.id),
    ),
  );
  return old.length;
}
