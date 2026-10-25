import type { BillingAggregateType, Database } from "@louez/db";

// Snapshot builders (louez-billing docs/api, openapi.yaml: StoreSnapshotV1,
// ReservationSnapshotV1, LegacyStoreSnapshotV1, LegacyMonthSnapshotV1).
//
// The relay calls `buildSnapshot` inside one read-only transaction started with
// `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY` on its own connection,
// after reading the queue row's version in the same transaction (README §5.2), so
// the version label and the content come from the same state. `db` is a Drizzle
// instance bound to that connection.

export type SnapshotKey = {
  readonly type: BillingAggregateType;
  /** A store or reservation id, or `{storeId}:{YYYY-MM}` for legacy_month. */
  readonly aggregateId: string;
  readonly storeId: string;
};

export type BuiltSnapshot =
  /** `data` exactly as the envelope carries it; the relay hashes and sends it. */
  | { readonly kind: "snapshot"; readonly data: Record<string, unknown> }
  /** The aggregate no longer exists in Louez (deleted store or reservation). */
  | { readonly kind: "missing" };

export type SnapshotContext = {
  /** Stores created at or after it are new: no legacy aggregates (README §8.3). */
  readonly newStoresFrom: Date;
};

export async function buildSnapshot(
  _db: Database,
  _key: SnapshotKey,
  _context: SnapshotContext,
): Promise<BuiltSnapshot> {
  throw new Error("buildSnapshot: written by work package A");
}
