import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import * as schema from './schema'
import { env } from './env'

const connectionString = env.DATABASE_URL

// Singleton pattern to prevent connection pool exhaustion in development
// Next.js hot reload creates new module instances, each creating a new pool
const globalForDb = globalThis as unknown as {
  pool: mysql.Pool | undefined
}

const pool =
  globalForDb.pool ??
  mysql.createPool({
    uri: connectionString,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  })

// In development, cache the pool to avoid "Too many connections" errors
if (env.NODE_ENV !== 'production') {
  globalForDb.pool = pool
}

export const db = drizzle(pool, { schema, mode: 'default' })

export type Database = typeof db
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Re-export schema for convenience
export * from './schema'
export {
  activeProductUnitCountSql,
  effectiveProductQuantitySql,
  getEffectiveProductQuantities,
} from './product-quantity'
export {
  BLOCKING_RESERVATION_STATUSES,
  buildReservationOverlapPredicate,
  buildUnitInDowntimeAtPredicate,
  buildUnitRentableDuringPredicate,
  findBusyUnitIds,
  getBlockingReservationStatuses,
} from './unit-availability'
export type { BlockingReservationStatus, BusyUnitReason } from './unit-availability'
export {
  ConsumableStockError,
  canTransitionReservationStatus,
  consumeReservationStock,
  getAllowedReservationStatusTransitions,
  hasProductStockKindChangeBlockers,
  loadConsumableReservedQuantities,
  lockProductReservationsForStockKindChange,
  planConsumableStockMutation,
  reconcileReservationStock,
  reservationStatusConsumesStock,
  restoreReservationStock,
} from './consumable-stock'
export type {
  ConsumableStockItem,
  ConsumableStockMutationMode,
  ConsumableStockMutationPlan,
} from './consumable-stock'

// Database setup utilities
export { setupDatabase, CORE_TABLES } from './setup'
