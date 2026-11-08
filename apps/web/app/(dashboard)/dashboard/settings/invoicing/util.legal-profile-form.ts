import type { LegalProfileView, UpsertLegalProfileInput } from "@louez/api/contracts/legal-profile";
import type { StoreLegalProfileInput } from "@louez/validations";

/** Nullable DB columns become empty strings so every input stays controlled. */
const orEmpty = (value: string | null | undefined) => value ?? "";

/**
 * Map the stored legal profile onto the form values.
 * `fallbackCountry` seeds a fresh profile from the store's billing address.
 */
export const toLegalProfileFormValues = (
  profile: LegalProfileView | null,
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

const orNull = (value: string) => (value.trim().length > 0 ? value : null);

/** The form's values as settings.upsertLegalProfile takes them: an empty optional field clears it. */
export const toLegalProfileInput = (values: StoreLegalProfileInput): UpsertLegalProfileInput => ({
  legalName: values.legalName,
  legalForm: values.legalForm,
  companyNumber: values.companyNumber,
  siret: orNull(values.siret),
  vatNumber: orNull(values.vatNumber),
  rcsCity: orNull(values.rcsCity),
  shareCapital: orNull(values.shareCapital),
  registeredAddress: values.registeredAddress,
  registeredAddressComplement: orNull(values.registeredAddressComplement),
  registeredPostalCode: values.registeredPostalCode,
  registeredCity: values.registeredCity,
  country: values.country,
  invoicingEnabled: values.invoicingEnabled,
  vatRegime: values.vatRegime,
  hasVatOnDebits: values.hasVatOnDebits,
});
