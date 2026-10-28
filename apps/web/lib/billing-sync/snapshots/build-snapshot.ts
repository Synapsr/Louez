import type { BillingAggregateType, Database } from "@louez/db";

import { buildLegacyMonthSnapshot } from "./legacy-month-snapshot";
import { buildLegacyStoreSnapshot } from "./legacy-store-snapshot";
import { buildReservationSnapshot } from "./reservation-snapshot";
import type { SnapshotData } from "./snapshot-data";
import { buildStoreSnapshot } from "./store-snapshot";

// Snapshot builders (louez-billing docs/api, openapi.yaml: StoreSnapshotV1,
// ReservationSnapshotV1, LegacyStoreSnapshotV1, LegacyMonthSnapshotV1).
//
// The relay calls `buildSnapshot` inside one read-only transaction started with
// `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY` on its own connection,
// after reading the queue row's version in the same transaction (README §5.2), so
// the version label and the content come from the same state. `db` is a Drizzle
// instance bound to that connection.
//
// A builder throws `SnapshotDataError` (snapshot-checks.ts) when the aggregate cannot
// be expressed within the contract, such as a list over its limit: retrying will not
// help, so the relay marks the row dead and alerts. Any other error is transient.

export type SnapshotKey = {
  readonly type: BillingAggregateType;
  /** A store or reservation id, or `{storeId}:{YYYY-MM}` for legacy_month. */
  readonly aggregateId: string;
  readonly storeId: string;
};

export type BuiltSnapshot<T extends SnapshotData = SnapshotData> =
  /** `data` exactly as the envelope carries it; the relay hashes and sends it. */
  | { readonly kind: "snapshot"; readonly data: T }
  /** The aggregate no longer exists in Louez (deleted store or reservation). */
  | { readonly kind: "missing" }
  /**
   * Nothing to send, by rule: `legacy_store` and `legacy_month` of a store created
   * at or after `newStoresFrom` (plan decision 4). The relay marks the row synced
   * for its version without calling the service.
   */
  | { readonly kind: "skip"; readonly reason: "new_store" };

export type SnapshotContext = {
  /** Stores created at or after it are new: no legacy aggregates (README §8.3). */
  readonly newStoresFrom: Date;
};

/** What the builders need: the database, a transaction, or Drizzle on one connection. */
export type SnapshotReader = Pick<Database, "select">;

export async function buildSnapshot(
  db: SnapshotReader,
  key: SnapshotKey,
  context: SnapshotContext,
): Promise<BuiltSnapshot> {
  switch (key.type) {
    case "store":
      return buildStoreSnapshot(db, key);
    case "reservation":
      return buildReservationSnapshot(db, key);
    case "legacy_store":
      return buildLegacyStoreSnapshot(db, key, context);
    case "legacy_month":
      return buildLegacyMonthSnapshot(db, key, context);
  }
}
