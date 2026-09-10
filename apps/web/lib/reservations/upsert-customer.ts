import { and, eq } from "drizzle-orm";

import type { Transaction } from "@louez/db";
import { customers } from "@louez/db";
import {
  isValidCompanyNumber,
  resolveCompanyNumberScheme,
  type CreateReservationCustomerInput,
} from "@louez/validations";

import type { CustomerCompanyIdentity } from "./billing-snapshot";

export type UpsertedCustomer = typeof customers.$inferSelect;

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
 */
export const upsertCustomer = async ({
  tx,
  storeId,
  storeCountry,
  customer,
  phone,
  companyIdentity,
}: {
  tx: Transaction;
  storeId: string;
  storeCountry: string;
  customer: CreateReservationCustomerInput;
  phone: string | null;
  companyIdentity: CustomerCompanyIdentity;
}): Promise<UpsertedCustomer | null> => {
  const existing = await tx.query.customers.findFirst({
    where: and(eq(customers.storeId, storeId), eq(customers.email, customer.email)),
  });

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
      })
      .$returningId();

    return (await tx.query.customers.findFirst({ where: eq(customers.id, inserted.id) })) ?? null;
  }

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
      updatedAt: new Date(),
    })
    .where(eq(customers.id, existing.id));

  return existing;
};
