import { type SQL, sql } from "drizzle-orm";

// Louez's marks for the billing service (louez-billing docs/api, README §5.2).
// A mark bumps an aggregate's version and makes its queue row pending; the relay
// then builds and sends a fresh snapshot. Marks write nothing unless Louez bills
// through the service: LOUEZ_BILLING=cloud with BILLING_SERVICE_URL set (§12).

export type BillingAggregateType = "store" | "reservation" | "legacy_store" | "legacy_month";

export type BillingMark = {
  readonly type: BillingAggregateType;
  /** A store or reservation id, or `{storeId}:{YYYY-MM}` for legacy_month. */
  readonly aggregateId: string;
  readonly storeId: string;
};

export type MarkOptions = {
  /**
   * A forced mark also clears the sent hash, so the relay sends the snapshot even
   * if its content did not change, and revives a dead row. Resyncs, requeues and
   * `pnpm billing:mark` use it.
   */
  readonly force?: boolean;
};

/** Anything Drizzle can run a statement on: the database or a transaction. */
export type MarkExecutor = { execute(query: SQL): Promise<unknown> };

/** Read at call time, so scripts and tests can set it after import. */
export function isBillingSyncEnabled(): boolean {
  return process.env.LOUEZ_BILLING === "cloud" && Boolean(process.env.BILLING_SERVICE_URL?.trim());
}

const onDuplicate = (force: boolean) =>
  force
    ? sql`version = version + 1, status = 'pending', sent_hash = NULL,
          next_attempt_at = CURRENT_TIMESTAMP(3), marked_at = CURRENT_TIMESTAMP(3)`
    : sql`version = version + 1, status = IF(status = 'dead', 'dead', 'pending'),
          next_attempt_at = CURRENT_TIMESTAMP(3), marked_at = CURRENT_TIMESTAMP(3)`;

/** The mark statement, for callers on a raw mysql2 connection (the pricing freeze). */
export function billingMarkStatement(
  marks: readonly BillingMark[],
  options: MarkOptions = {},
): { sql: string; params: string[] } | null {
  const unique = dedupe(marks);
  if (unique.length === 0) return null;
  const update = options.force
    ? "version = version + 1, status = 'pending', sent_hash = NULL, next_attempt_at = CURRENT_TIMESTAMP(3), marked_at = CURRENT_TIMESTAMP(3)"
    : "version = version + 1, status = IF(status = 'dead', 'dead', 'pending'), next_attempt_at = CURRENT_TIMESTAMP(3), marked_at = CURRENT_TIMESTAMP(3)";
  return {
    sql:
      "INSERT INTO billing_sync_queue (aggregate_type, aggregate_id, store_id) VALUES " +
      unique.map(() => "(?, ?, ?)").join(", ") +
      ` ON DUPLICATE KEY UPDATE ${update}`,
    params: unique.flatMap((mark) => [mark.type, mark.aggregateId, mark.storeId]),
  };
}

function dedupe(marks: readonly BillingMark[]): BillingMark[] {
  const seen = new Map<string, BillingMark>();
  for (const mark of marks) seen.set(`${mark.type}\u0000${mark.aggregateId}`, mark);
  return [...seen.values()];
}

/**
 * Marks aggregates dirty. Call it inside the transaction that changed them; where a
 * write has no transaction, call it right after the write with the same executor
 * (the nightly sweep heals a crash between the two).
 */
export async function markBillingDirty(
  executor: MarkExecutor,
  marks: readonly BillingMark[],
  options: MarkOptions = {},
): Promise<void> {
  if (!isBillingSyncEnabled()) return;
  const unique = dedupe(marks);
  if (unique.length === 0) return;
  const values = sql.join(
    unique.map((mark) => sql`(${mark.type}, ${mark.aggregateId}, ${mark.storeId})`),
    sql`, `,
  );
  await executor.execute(
    sql`INSERT INTO billing_sync_queue (aggregate_type, aggregate_id, store_id) VALUES ${values}
        ON DUPLICATE KEY UPDATE ${onDuplicate(Boolean(options.force))}`,
  );
}

export function markReservation(
  executor: MarkExecutor,
  reservation: { readonly id: string; readonly storeId: string },
  options?: MarkOptions,
): Promise<void> {
  return markBillingDirty(
    executor,
    [{ type: "reservation", aggregateId: reservation.id, storeId: reservation.storeId }],
    options,
  );
}

/**
 * Marks reservations known by id only, such as after a payment write: the store
 * id is read in the same statement. Unknown ids are skipped.
 */
export async function markReservationIds(
  executor: MarkExecutor,
  reservationIds: readonly string[],
  options: MarkOptions = {},
): Promise<void> {
  if (!isBillingSyncEnabled()) return;
  const ids = [...new Set(reservationIds.filter(Boolean))];
  if (ids.length === 0) return;
  await executor.execute(
    sql`INSERT INTO billing_sync_queue (aggregate_type, aggregate_id, store_id)
        SELECT 'reservation', r.id, r.store_id FROM reservations r
        WHERE r.id IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})
        ON DUPLICATE KEY UPDATE ${onDuplicate(Boolean(options.force))}`,
  );
}

export function markStore(
  executor: MarkExecutor,
  storeId: string,
  options?: MarkOptions,
): Promise<void> {
  return markBillingDirty(executor, [{ type: "store", aggregateId: storeId, storeId }], options);
}

export function markLegacyStore(
  executor: MarkExecutor,
  storeId: string,
  options?: MarkOptions,
): Promise<void> {
  return markBillingDirty(
    executor,
    [{ type: "legacy_store", aggregateId: storeId, storeId }],
    options,
  );
}

/** `period` is `YYYY-MM`, the `billing_month` of the fee or invoice row. */
export function markLegacyMonth(
  executor: MarkExecutor,
  storeId: string,
  period: string,
  options?: MarkOptions,
): Promise<void> {
  return markBillingDirty(
    executor,
    [{ type: "legacy_month", aggregateId: `${storeId}:${period}`, storeId }],
    options,
  );
}
