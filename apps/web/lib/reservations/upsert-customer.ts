import { and, eq } from "drizzle-orm";

import type { Transaction } from "@louez/db";
import { customers } from "@louez/db";
import {
  digitsOnly,
  isPlausibleVatNumber,
  isValidCompanyNumber,
  resolveCompanyNumberScheme,
  type CreateReservationCustomerInput,
} from "@louez/validations";

export interface CustomerCompanyIdentity {
  companyNumber: string | null;
  companyNumberScheme: "fr_siren" | "be_bce" | null;
  vatNumber: string | null;
}

/**
 * Normalize and validate company identifiers before persisting invoice data.
 * Null means the business identity is invalid (missing company name, bad
 * SIREN/BCE, implausible VAT number).
 */
export const resolveCustomerCompanyIdentity = (
  customer: CreateReservationCustomerInput,
  country: string,
): CustomerCompanyIdentity | null => {
  const empty: CustomerCompanyIdentity = {
    companyNumber: null,
    companyNumberScheme: null,
    vatNumber: null,
  };

  if (customer.customerType !== "business") return empty;
  if (!customer.companyName?.trim()) return null;

  const scheme = resolveCompanyNumberScheme(country);
  const rawCompanyNumber = customer.companyNumber?.trim() ?? "";
  let companyNumber: string | null = null;

  if (rawCompanyNumber) {
    if (!isValidCompanyNumber(country, rawCompanyNumber)) return null;
    companyNumber = scheme ? digitsOnly(rawCompanyNumber) : rawCompanyNumber;
  }

  const vatNumber = customer.vatNumber?.replace(/\s/g, "").toUpperCase() ?? "";
  if (!isPlausibleVatNumber(country, vatNumber)) return null;

  return {
    companyNumber,
    companyNumberScheme: companyNumber ? scheme : null,
    vatNumber: vatNumber || null,
  };
};

export type UpsertedCustomer = typeof customers.$inferSelect;

/**
 * Customer identity is `(storeId, email)`. A new customer takes the checkout
 * fields as is; an existing one is refreshed field by field, keeping what is
 * already on file when the checkout omits it.
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
  const effectiveCompanyNumber = companyIdentity.companyNumber ?? existing.companyNumber;
  const buyerCountry = existing.country || storeCountry;

  await tx
    .update(customers)
    .set({
      firstName: customer.firstName,
      lastName: customer.lastName,
      customerType: customer.customerType || existing.customerType,
      companyName: customer.companyName ?? existing.companyName,
      companyNumber: effectiveCompanyNumber,
      companyNumberScheme:
        effectiveCompanyNumber && isValidCompanyNumber(buyerCountry, effectiveCompanyNumber)
          ? resolveCompanyNumberScheme(buyerCountry)
          : null,
      vatNumber: companyIdentity.vatNumber ?? existing.vatNumber,
      phone: phone || existing.phone,
      address: customer.address || existing.address,
      city: customer.city || existing.city,
      postalCode: customer.postalCode || existing.postalCode,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, existing.id));

  return existing;
};
