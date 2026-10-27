// The cloud's billing service keeps its own tables in Louez's database. Louez
// never reads or writes them, and its setup, migrations and drizzle-kit leave
// them alone. Self-hosted databases have none. This module has no side effects:
// drizzle.config.ts imports it.

/** Every table of the billing service starts with this prefix. */
export const BILLING_SERVICE_TABLE_PREFIX = "billing_service_";

/** Where the billing service records its migrations, apart from `__drizzle_migrations`. */
export const BILLING_SERVICE_MIGRATIONS_TABLE = "__billing_service_migrations";

/** Whether a table belongs to the billing service rather than to Louez. */
export function isBillingServiceTable(name: string): boolean {
  return name.startsWith(BILLING_SERVICE_TABLE_PREFIX) || name === BILLING_SERVICE_MIGRATIONS_TABLE;
}
