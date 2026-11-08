import { db, lockStoreRow, markStore, storeLegalProfiles, type Transaction } from "@louez/db";
import {
  normalizeShareCapital,
  resolveCompanyNumberScheme,
  storeLegalProfileSchema,
  type StoreLegalProfileInput,
} from "@louez/validations";
import { eq } from "drizzle-orm";

import { searchFrenchCompanies } from "../adapters/company-registry";
import {
  legalProfileErrors,
  type LegalProfileProblem,
  type LegalProfileView,
  type UpsertLegalProfileInput,
} from "../contracts/legal-profile";
import { platformErrors } from "../platform/errors";
import type { ConfirmStep } from "./products";
import type { SettingsActor, SettingsChange } from "./settings";

/**
 * The store's legal identity (`store_legal_profiles`), as the dashboard's
 * invoicing page and an agent set it, and the French company registry they
 * look it up in.
 *
 * A write locks the store row first, then reads the profile and writes it
 * back merged: a field left out keeps its value, null clears an optional one.
 * The merged profile is checked with the dashboard form's own schema. Only
 * the electronic invoicing switches ask for a confirmation: they decide
 * whether Louez issues the store's invoices to the tax network. The identity
 * itself is text, as the legal texts are, and runs directly.
 */

type ProfileRow = typeof storeLegalProfiles.$inferSelect;

export const toLegalProfileView = (row: ProfileRow): LegalProfileView => ({
  legalName: row.legalName,
  legalForm: row.legalForm,
  companyNumber: row.companyNumber,
  companyNumberScheme: row.companyNumberScheme,
  siret: row.siret,
  vatNumber: row.vatNumber,
  rcsCity: row.rcsCity,
  shareCapital: row.shareCapital,
  registeredAddress: row.registeredAddress,
  registeredAddressComplement: row.registeredAddressComplement,
  registeredPostalCode: row.registeredPostalCode,
  registeredCity: row.registeredCity,
  country: row.country,
  invoicingEnabled: row.invoicingEnabled,
  vatRegime: row.vatRegime,
  hasVatOnDebits: row.hasVatOnDebits,
  updatedAt: row.updatedAt.toISOString(),
});

async function readProfile(executor: typeof db | Transaction, storeId: string) {
  const [row] = await executor
    .select()
    .from(storeLegalProfiles)
    .where(eq(storeLegalProfiles.storeId, storeId))
    .limit(1);
  return row ?? null;
}

/** The store's legal profile, or null before it saved one. */
export async function getLegalProfile(storeId: string): Promise<LegalProfileView | null> {
  const row = await readProfile(db, storeId);
  return row ? toLegalProfileView(row) : null;
}

/** What a confirmation of the invoicing switches shows. */
export interface LegalProfilePreview {
  summary: string;
  changes: Record<string, SettingsChange>;
}

const orEmpty = (value: string | null | undefined) => value ?? "";

type TextField = Exclude<
  keyof UpsertLegalProfileInput,
  "country" | "invoicingEnabled" | "vatRegime" | "hasVatOnDebits"
>;

/** The stored profile with the input laid over it, in the dashboard form's shape. */
function merge(
  stored: ProfileRow | null,
  input: UpsertLegalProfileInput,
  fallbackCountry: string,
): StoreLegalProfileInput {
  const pick = (key: TextField, current: string | null | undefined) => {
    const value = input[key];
    return value === undefined ? orEmpty(current) : orEmpty(value);
  };
  return {
    legalName: pick("legalName", stored?.legalName),
    legalForm: pick("legalForm", stored?.legalForm),
    companyNumber: pick("companyNumber", stored?.companyNumber),
    siret: pick("siret", stored?.siret),
    vatNumber: pick("vatNumber", stored?.vatNumber),
    rcsCity: pick("rcsCity", stored?.rcsCity),
    shareCapital: pick("shareCapital", stored?.shareCapital),
    registeredAddress: pick("registeredAddress", stored?.registeredAddress),
    registeredAddressComplement: pick(
      "registeredAddressComplement",
      stored?.registeredAddressComplement,
    ),
    registeredPostalCode: pick("registeredPostalCode", stored?.registeredPostalCode),
    registeredCity: pick("registeredCity", stored?.registeredCity),
    country: input.country ?? stored?.country ?? fallbackCountry,
    invoicingEnabled: input.invoicingEnabled ?? stored?.invoicingEnabled ?? false,
    vatRegime: input.vatRegime === undefined ? (stored?.vatRegime ?? null) : input.vatRegime,
    hasVatOnDebits: input.hasVatOnDebits ?? stored?.hasVatOnDebits ?? false,
  };
}

/** The merged profile, checked as the dashboard's form checks it. */
function validate(profile: StoreLegalProfileInput): StoreLegalProfileInput {
  const parsed = storeLegalProfileSchema.safeParse(profile);
  if (parsed.success) return parsed.data;
  const problems = new Map<string, LegalProfileProblem>();
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "profile");
    if (problems.has(field)) continue;
    problems.set(field, {
      field,
      problem: issue.message === "validation.required" ? "required" : "format",
    });
  }
  throw legalProfileErrors.invalid([...problems.values()]);
}

const INVOICING_FIELDS = ["invoicingEnabled", "vatRegime", "hasVatOnDebits"] as const;

/**
 * Saves the store's legal profile: creates it, or changes the fields sent.
 * The legal country and the invoicing switch are in the store's billing
 * snapshot, so the store is marked.
 */
export async function upsertLegalProfile(
  actor: SettingsActor,
  input: UpsertLegalProfileInput,
  options: { fallbackCountry: string; confirm?: ConfirmStep<LegalProfilePreview> },
): Promise<LegalProfileView> {
  const { storeId } = actor;
  let refusal: Error | null = null;

  const saved = await db.transaction(async (tx) => {
    if (!(await lockStoreRow(tx, storeId))) throw platformErrors.noStore();
    const stored = await readProfile(tx, storeId);
    const profile = validate(merge(stored, input, options.fallbackCountry));

    const before = {
      invoicingEnabled: stored?.invoicingEnabled ?? false,
      vatRegime: stored?.vatRegime ?? null,
      hasVatOnDebits: stored?.hasVatOnDebits ?? false,
    };
    const changes: Record<string, SettingsChange> = {};
    for (const field of INVOICING_FIELDS) {
      if (before[field] !== profile[field])
        changes[field] = { from: before[field], to: profile[field] };
    }
    if (options.confirm && Object.keys(changes).length > 0) {
      const issuing = profile.invoicingEnabled;
      refusal = await options.confirm(
        {
          summary: issuing
            ? `Louez will issue this store's invoices as legal electronic invoices, sent to the tax network, declared with VAT ${profile.vatRegime ?? "not set"}${profile.hasVatOnDebits ? " on debits" : ""}.`
            : "Louez will stop issuing this store's invoices as legal electronic invoices.",
          changes,
        },
        tx,
      );
      if (refusal) return null;
    }

    const emptyToNull = (value: string) => (value.length > 0 ? value : null);
    const values = {
      legalName: profile.legalName,
      legalForm: profile.legalForm,
      companyNumber: profile.companyNumber,
      // Derived here so the scheme can never contradict the country.
      companyNumberScheme: resolveCompanyNumberScheme(profile.country),
      siret: emptyToNull(profile.siret),
      vatNumber: emptyToNull(profile.vatNumber),
      rcsCity: emptyToNull(profile.rcsCity),
      shareCapital: normalizeShareCapital(profile.shareCapital),
      registeredAddress: profile.registeredAddress,
      registeredAddressComplement: emptyToNull(profile.registeredAddressComplement),
      registeredPostalCode: profile.registeredPostalCode,
      registeredCity: profile.registeredCity,
      country: profile.country,
      invoicingEnabled: profile.invoicingEnabled,
      vatRegime: profile.vatRegime,
      hasVatOnDebits: profile.hasVatOnDebits,
      updatedAt: new Date(),
    };
    await tx
      .insert(storeLegalProfiles)
      .values({ storeId, ...values })
      .onDuplicateKeyUpdate({ set: values });
    await markStore(tx, storeId);
    return readProfile(tx, storeId);
  });

  if (refusal) throw refusal;
  if (!saved) throw platformErrors.noStore();

  try {
    actor.afterCommit({ type: "store.legalProfileUpdated", store: actor.store });
  } catch (error) {
    console.error("A legal profile effect failed after its commit:", error);
  }
  return toLegalProfileView(saved);
}

/** The French registry's companies matching a name, a SIREN or a SIRET. */
export async function searchCompanyRegistry(query: string) {
  const search = await searchFrenchCompanies(query);
  if (!search.ok) {
    console.warn(`Company registry: ${search.reason}`);
    return { available: false, results: [] };
  }
  return { available: true, results: search.results };
}
