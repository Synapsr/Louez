import { and, eq } from "drizzle-orm";

import type { Transaction } from "@louez/db";
import { customers, lockCustomerRow } from "@louez/db";
import type { CustomerCreatedVia } from "@louez/types";
import {
  isValidCompanyNumber,
  resolveCompanyNumberScheme,
  type CreateReservationCustomerInput,
} from "@louez/validations";

import type { CustomerCompanyIdentity } from "./billing-snapshot";
import type { ReservationSource } from "./reservation.types";

export type UpsertedCustomer = typeof customers.$inferSelect;

/** The channel a new customer is credited to. "phone" is the AI receptionist. */
const CREATED_VIA_BY_SOURCE = {
  online: "storefront",
  marketplace: "marketplace",
  phone: "ai",
} as const satisfies Record<ReservationSource, CustomerCreatedVia>;

/**
 * Customer identity is `(storeId, email)`. A new customer takes the checkout
 * fields as is; an existing one is refreshed field by field, keeping what is
 * already on file when the checkout omits it.
 *
 * The profile's `customerType` is a default for prefilling the next checkout,
 * not a record of how this reservation is billed: that lives on the
 * reservation's billing snapshot. A checkout therefore never flips an existing
 * profile between individual and business. A business checkout refreshes the
 * saved company so the next checkout can offer it; an individual checkout
 * leaves the saved company alone.
 *
 * `createdVia` records where the customer first came from: it is written with
 * the new record and never revisited by a later checkout.
 *
 * The existing customer is read under its row's lock (lock order: the
 * checkout's products, then the customer), so the row it returns is one that
 * exists until the checkout commits.
 */
/** How many times the e-mail is resolved again when its customer changed under the lock. */
const CUSTOMER_LOCK_ATTEMPTS = 3;

/**
 * The store's customer with this e-mail, locked through its primary key, as
 * every writer locks a customer (the deletion by id too): the id is found
 * first with no lock, then the row is locked by id and checked again under
 * the lock. A row gone, moved to another store or given another e-mail since
 * the read resolves the e-mail again, up to `CUSTOMER_LOCK_ATTEMPTS` times;
 * past that, "busy", and the checkout fails as for a customer it could not
 * write. Null when the store has no customer with this e-mail.
 */
async function lockCustomerByEmail(
  tx: Transaction,
  storeId: string,
  email: string,
): Promise<UpsertedCustomer | null | "busy"> {
  for (let attempt = 0; attempt < CUSTOMER_LOCK_ATTEMPTS; attempt += 1) {
    const [candidate] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.storeId, storeId), eq(customers.email, email)))
      .limit(1);
    if (!candidate) return null;
    await lockCustomerRow(tx, candidate.id);
    const [locked] = await tx.select().from(customers).where(eq(customers.id, candidate.id));
    // The column's collation compares e-mails without case, as the read did.
    if (locked?.storeId === storeId && locked.email.toLowerCase() === email.toLowerCase()) {
      return locked;
    }
  }
  return "busy";
}

export const upsertCustomer = async ({
  tx,
  storeId,
  storeCountry,
  source,
  customer,
  phone,
  companyIdentity,
  isTest = false,
}: {
  tx: Transaction;
  storeId: string;
  storeCountry: string;
  source: ReservationSource;
  customer: CreateReservationCustomerInput;
  phone: string | null;
  companyIdentity: CustomerCompanyIdentity;
  /**
   * A test checkout (lib/test-reservations): a new customer is a test one, and a
   * real customer with the owner's e-mail (the owner's own record) is used as is,
   * never changed.
   */
  isTest?: boolean;
}): Promise<UpsertedCustomer | null> => {
  // Locked, in the checkout's transaction, after its products: a reservation is
  // never created for a customer who no longer exists. A customer's deletion
  // takes the store row then the customer: it waits for this lock, or this
  // read waits for it and finds no customer, who is then added again below.
  const existing = await lockCustomerByEmail(tx, storeId, customer.email);
  if (existing === "busy") return null;

  if (!existing) {
    const [inserted] = await tx
      .insert(customers)
      .values({
        storeId,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        customerType: customer.customerType || "individual",
        companyName: customer.companyName || null,
        companyNumber: companyIdentity.companyNumber,
        companyNumberScheme: companyIdentity.companyNumberScheme,
        vatNumber: companyIdentity.vatNumber,
        phone,
        address: customer.address || null,
        city: customer.city || null,
        postalCode: customer.postalCode || null,
        country: storeCountry,
        createdVia: CREATED_VIA_BY_SOURCE[source],
        isTest,
      })
      .$returningId();

    return (await tx.query.customers.findFirst({ where: eq(customers.id, inserted.id) })) ?? null;
  }

  if (isTest && !existing.isTest) return existing;

  // Identifiers already on file survive a checkout that omits them; the
  // scheme is re-derived from the buyer's own country, never trusted.
  const isBusinessCheckout = customer.customerType === "business";
  const effectiveCompanyNumber = isBusinessCheckout
    ? (companyIdentity.companyNumber ?? existing.companyNumber)
    : existing.companyNumber;
  const buyerCountry = existing.country || storeCountry;

  await tx
    .update(customers)
    .set({
      firstName: customer.firstName,
      lastName: customer.lastName,
      companyName: isBusinessCheckout
        ? (customer.companyName ?? existing.companyName)
        : existing.companyName,
      companyNumber: effectiveCompanyNumber,
      companyNumberScheme:
        effectiveCompanyNumber && isValidCompanyNumber(buyerCountry, effectiveCompanyNumber)
          ? resolveCompanyNumberScheme(buyerCountry)
          : null,
      vatNumber: isBusinessCheckout
        ? (companyIdentity.vatNumber ?? existing.vatNumber)
        : existing.vatNumber,
      phone: phone || existing.phone,
      address: customer.address || existing.address,
      city: customer.city || existing.city,
      postalCode: customer.postalCode || existing.postalCode,
      // A real checkout under a test customer's e-mail makes them a real customer.
      ...(existing.isTest && !isTest ? { isTest: false } : {}),
      updatedAt: new Date(),
    })
    .where(eq(customers.id, existing.id));

  return existing.isTest && !isTest ? { ...existing, isTest: false } : existing;
};
