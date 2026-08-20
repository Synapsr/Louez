import type { StoreLegalProfileInput } from "@louez/validations";

import type { StoreLegalProfileRecord } from "./actions";

/** Nullable DB columns become empty strings so every input stays controlled. */
const orEmpty = (value: string | null | undefined) => value ?? "";

/**
 * Map the stored legal profile onto the form values.
 * `fallbackCountry` seeds a fresh profile from the store's billing address.
 */
export const toLegalProfileFormValues = (
  profile: StoreLegalProfileRecord | null,
  fallbackCountry: string,
): StoreLegalProfileInput => ({
  legalName: orEmpty(profile?.legalName),
  legalForm: orEmpty(profile?.legalForm),
  companyNumber: orEmpty(profile?.companyNumber),
  siret: orEmpty(profile?.siret),
  vatNumber: orEmpty(profile?.vatNumber),
  rcsCity: orEmpty(profile?.rcsCity),
  shareCapital: orEmpty(profile?.shareCapital),
  registeredAddress: orEmpty(profile?.registeredAddress),
  registeredAddressComplement: orEmpty(profile?.registeredAddressComplement),
  registeredPostalCode: orEmpty(profile?.registeredPostalCode),
  registeredCity: orEmpty(profile?.registeredCity),
  country: profile?.country ?? fallbackCountry,
  invoicingEnabled: profile?.invoicingEnabled ?? false,
  vatRegime: profile?.vatRegime ?? null,
  hasVatOnDebits: profile?.hasVatOnDebits ?? false,
});

/**
 * Step 1 is complete once every field printed on a legal invoice is filled.
 * Step 2 (letting Louez issue the invoices) stays locked until then.
 */
export const isLegalIdentityComplete = (values: StoreLegalProfileInput): boolean =>
  values.legalName.trim().length > 0 &&
  values.legalForm.trim().length > 0 &&
  values.companyNumber.trim().length > 0 &&
  values.registeredAddress.trim().length > 0 &&
  values.registeredPostalCode.trim().length > 0 &&
  values.registeredCity.trim().length > 0 &&
  values.country.trim().length === 2;
