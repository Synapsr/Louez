import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, reservations, type Transaction } from "@louez/db";

/**
 * Storefront reservation number `R{yy}{mm}-NNNN`, checked against the store
 * before use with a nanoid fallback. Extracted unchanged from the checkout
 * action: the check-then-insert race is known and left for a later unique
 * index (see the redesign decisions). `executor` is where the check reads:
 * the database by default; a transaction for a writer that checks under
 * its own lock (services/reservation-create.ts).
 */
export async function generateUniqueReservationNumber(
  storeId: string,
  maxRetries = 5,
  executor: Pick<typeof db, "query"> | Transaction = db,
): Promise<string> {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const prefix = `R${year}${month}-`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Use crypto for better randomness
    const randomBytes = new Uint32Array(1);
    crypto.getRandomValues(randomBytes);
    const random = (randomBytes[0] % 10000).toString().padStart(4, "0");
    const number = `${prefix}${random}`;

    // Check if this number already exists for this store
    const existing = await executor.query.reservations.findFirst({
      where: and(eq(reservations.storeId, storeId), eq(reservations.number, number)),
    });

    if (!existing) {
      return number;
    }
  }

  // If all retries failed, use timestamp + nanoid for guaranteed uniqueness
  const fallbackRandom = nanoid(6).toUpperCase();
  return `${prefix}${fallbackRandom}`;
}
