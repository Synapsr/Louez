import { hostname } from "node:os";

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";
import { env } from "./env";

const connectionString = env.DATABASE_URL;

// Singleton pattern to prevent connection pool exhaustion in development
// Next.js hot reload creates new module instances, each creating a new pool
const globalForDb = globalThis as unknown as {
  pool: mysql.Pool | undefined;
};

const pool =
  globalForDb.pool ??
  mysql.createPool({
    uri: connectionString,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // A pooled connection can sit idle for long at night, and Docker Swarm's network
    // drops one after 15 idle minutes without telling either end. A query sent on it
    // then waits about 15 minutes for Linux to give up. A probe after one idle minute
    // keeps it open. 0 would leave the OS default, two hours.
    enableKeepAlive: true,
    keepAliveInitialDelay: 60_000,
    // Names the machine in MySQL's performance_schema.session_connect_attrs: behind
    // Docker Swarm's ingress, a client that comes through a published port shows the
    // ingress's address, not its own.
    connectAttributes: { program_name: `louez@${hostname()}` },
    // A `Date` bound to a raw SQL expression has no column to encode it, so mysql2
    // writes it itself, by default in the process's local time. Drizzle writes every
    // timestamp column in UTC: on a server whose TZ is not UTC, a comparison between
    // the two was off by the offset (the overlap predicate compares a booking's end
    // with such a `Date`). "Z" makes mysql2 write and read dates in UTC too.
    timezone: "Z",
  });

// In development, cache the pool to avoid "Too many connections" errors
if (env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
}

export const db = drizzle(pool, { schema, mode: "default" });

export type Database = typeof db;

/**
 * Drizzle on one connection taken from the pool: its queries and transactions all run
 * on that connection. For work under a MySQL named lock, which belongs to the
 * connection that took it, so the work needs no second connection from the pool.
 */
export function databaseOnConnection(connection: mysql.PoolConnection) {
  return drizzle(connection, { schema, mode: "default" });
}

export type DatabaseOnConnection = ReturnType<typeof databaseOnConnection>;
export { cancelFailedCheckoutReservation } from "./failed-checkout";
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Re-export schema for convenience
export * from "./schema";
export * from "./billing-queue";
export * from "./billing-policy";
export {
  activeProductUnitCountSql,
  effectiveProductQuantitySql,
  getEffectiveProductQuantities,
} from "./product-quantity";
export { isPaymentReceiptSql, isStripeRefundPaymentSql } from "./payment-receipts";
export {
  BLOCKING_RESERVATION_STATUSES,
  buildReservationAvailabilityPredicate,
  buildReservationOverlapPredicate,
  reservationAvailabilityEndSql,
  reservationStillHoldsUnitsSql,
  getReservationAvailabilityEnd,
  buildUnitInDowntimeAtPredicate,
  buildUnitRentableDuringPredicate,
  findBusyUnitIds,
  getBlockingReservationStatuses,
} from "./unit-availability";
export type { BlockingReservationStatus, BusyUnitReason } from "./unit-availability";
export {
  ConsumableStockError,
  canTransitionReservationStatus,
  consumeReservationStock,
  getAllowedReservationStatusTransitions,
  getProductStockKindChangeBlockers,
  loadConsumableReservedQuantities,
  lockProductReservationsForStockKindChange,
  planConsumableStockMutation,
  reconcileReservationStock,
  reservationStatusConsumesStock,
  restoreReservationStock,
} from "./consumable-stock";
export type {
  ConsumableStockItem,
  ConsumableStockMutationMode,
  ConsumableStockMutationPlan,
  StockKindChangeBlocker,
} from "./consumable-stock";
export {
  BILLABLE_RESERVATION_STATUSES,
  changeReservationStatus,
  isBillableReservationStatus,
  isFeeVoidingReservationStatus,
  requiresReservationGate,
  toWholeSeconds,
} from "./reservation-status";
export {
  ReservationLockError,
  ReservationProductsChangedError,
  isReservationProductsChangedError,
  lockReservationInTransaction,
  lockReservationOnlyInTransaction,
} from "./reservation-lock";
export type {
  InsertedReservationLock,
  ReservationLock,
  ReservationOnlyLock,
  ReservationProductsLock,
  ReservationScope,
  ReservationStatusLock,
  ReservationStockLock,
  ReservationTransaction,
} from "./reservation-lock";
export {
  ReservationChangeBusyError,
  isReservationChangeBusyError,
  runReservationChange,
  runReservationOnlyChange,
  runReservationTransaction,
} from "./reservation-change";
export {
  STORE_NOT_ACCEPTING_RESERVATIONS,
  StoreNotAcceptingReservationsError,
  assertStoreCanTakeReservations,
  isStoreNotAcceptingReservationsError,
  readReservationGate,
  readReservationGateSince,
  readStoresNotAcceptingReservations,
} from "./reservation-gate";
export type { ReservationGate, ReservationGateReason } from "./reservation-gate";
export type {
  ChangeReservationStatusInput,
  ChangeReservationStatusResult,
  ReservationActivityType,
  ReservationActor,
  ReservationBillingEffect,
  ReservationEffectRunner,
  ReservationStatus,
  ReservationStatusRefusal,
} from "./reservation-status";
export { initialBillableAt, insertReservation } from "./reservation-insert";
export type { ReservationInsertValues } from "./reservation-insert";
export { countBillableReservationsWithoutBillableAt } from "./reservation-invariants";
export { isDuplicateKeyError } from "./duplicate-key";
export { lockStoreRow, mergeStoreRow, type StoreJson, type StoreRowUpdate } from "./store-row";
export {
  currentApiOperation,
  markSetupWrite,
  runInApiOperation,
  unmarkSetupWrite,
  type ApiOperationScope,
} from "./api-operation-scope";
export {
  isDatabaseDeadlock,
  isTransactionInterrupted,
  retryOnceOnDeadlock,
  retryTransactionOnDeadlock,
} from "./deadlock";

export { SLUG_MAX_LENGTH, isSlug, pickUniqueSlug, slugify } from "./slug";
export { nextCategorySlug, nextProductSlug } from "./slugs";

// Database setup utilities
export { setupDatabase, CORE_TABLES } from "./setup";
