"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { db, storeLegalProfiles } from "@louez/db";
import {
  companySearchSchema,
  normalizeShareCapital,
  resolveCompanyNumberScheme,
  storeLegalProfileSchema,
  type StoreLegalProfileInput,
} from "@louez/validations";

import { searchFrenchCompanies, type CompanySearchResult } from "@/lib/recherche-entreprises";
import { getCurrentStore } from "@/lib/store-context";

export type StoreLegalProfileRecord = typeof storeLegalProfiles.$inferSelect;

export type StoreLegalProfileQueryResult =
  | { status: "success"; profile: StoreLegalProfileRecord | null }
  | { status: "error"; error: string };

export type StoreLegalProfileActionResult =
  | { status: "success" }
  | { status: "error"; error: string };

/** Read the legal profile of the active store. */
export async function getStoreLegalProfile(): Promise<StoreLegalProfileQueryResult> {
  const store = await getCurrentStore();
  if (!store) {
    return { status: "error", error: "errors.unauthorized" };
  }

  const profile = await db.query.storeLegalProfiles.findFirst({
    where: eq(storeLegalProfiles.storeId, store.id),
  });

  return { status: "success", profile: profile ?? null };
}

/** Create or update the legal profile of the active store. */
export async function upsertStoreLegalProfile(
  data: StoreLegalProfileInput,
): Promise<StoreLegalProfileActionResult> {
  const store = await getCurrentStore();
  if (!store) {
    return { status: "error", error: "errors.unauthorized" };
  }

  const validated = storeLegalProfileSchema.safeParse(data);
  if (!validated.success) {
    return { status: "error", error: "errors.invalidData" };
  }

  const input = validated.data;
  const emptyToNull = (value: string) => (value.length > 0 ? value : null);

  const values = {
    legalName: input.legalName,
    legalForm: input.legalForm,
    companyNumber: input.companyNumber,
    // Derived server-side so the scheme can never contradict the country.
    companyNumberScheme: resolveCompanyNumberScheme(input.country),
    siret: emptyToNull(input.siret),
    vatNumber: emptyToNull(input.vatNumber),
    rcsCity: emptyToNull(input.rcsCity),
    shareCapital: normalizeShareCapital(input.shareCapital),
    registeredAddress: input.registeredAddress,
    registeredAddressComplement: emptyToNull(input.registeredAddressComplement),
    registeredPostalCode: input.registeredPostalCode,
    registeredCity: input.registeredCity,
    country: input.country,
    invoicingEnabled: input.invoicingEnabled,
    vatRegime: input.vatRegime,
    hasVatOnDebits: input.hasVatOnDebits,
    updatedAt: new Date(),
  };

  await db
    .insert(storeLegalProfiles)
    .values({ storeId: store.id, ...values })
    .onDuplicateKeyUpdate({ set: values });

  revalidatePath("/dashboard/settings/invoicing");
  return { status: "success" };
}

/** Look up a French company in the public registry to prefill the form. */
export async function searchCompanyRegistry(query: string): Promise<{
  error?: string;
  results: CompanySearchResult[];
}> {
  const store = await getCurrentStore();
  if (!store) {
    return { error: "errors.unauthorized", results: [] };
  }

  const validated = companySearchSchema.safeParse({ query });
  if (!validated.success) {
    return { error: "errors.invalidData", results: [] };
  }

  const results = await searchFrenchCompanies(validated.data.query);
  return { results };
}
