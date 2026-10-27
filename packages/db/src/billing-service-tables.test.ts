import assert from "node:assert/strict";
import { test } from "node:test";

import { getTableName, isTable, type Table } from "drizzle-orm";

import { isBillingServiceTable } from "./billing-service-tables";
import * as schema from "./schema";

test("only the billing service's prefix and migrations table are the service's", () => {
  for (const table of [
    "billing_service_stores",
    "billing_service_reservations",
    "__billing_service_migrations",
  ]) {
    assert.equal(isBillingServiceTable(table), true, table);
  }
  for (const table of [
    "stores",
    "reservations",
    "__drizzle_migrations",
    "billing_sync_queue",
    "billing_policies",
    "billing_services",
    "billingXservice_stores",
    "louez_billing_service_stores",
    "_billing_service_migrations",
  ]) {
    assert.equal(isBillingServiceTable(table), false, table);
  }
});

test("no Louez table takes a name the guards would hide", () => {
  const exports: Record<string, unknown> = schema;
  const louezTables = Object.values(exports)
    .filter((value): value is Table => isTable(value))
    .map((table) => getTableName(table));
  assert.ok(louezTables.length > 0);
  assert.deepEqual(louezTables.filter(isBillingServiceTable), []);
});
