import { sql } from "drizzle-orm";

import type { Database, Transaction } from "./index";

/**
 * The row lock on a customer, taken the same way by every writer that locks
 * one (the checkout, the store's creation of a reservation, the customer's
 * deletion): by its id, through the primary key. The statement names the
 * index it reads through, so the lock is the primary key's and never an
 * entry of another index of the table (the store's unique e-mail), which a
 * writer that locked through it would hold while it waits for the row: two
 * such writers could each hold what the other needs.
 *
 * A writer that knows the customer by e-mail finds the id with no lock,
 * locks the row with this, then reads it again and checks it under the lock.
 */
export async function lockCustomerRow(
  tx: Transaction | Database,
  customerId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT id FROM customers FORCE INDEX (PRIMARY) WHERE id = ${customerId} FOR UPDATE`,
  );
}
