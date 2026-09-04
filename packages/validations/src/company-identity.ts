/** Company-number schemes understood by Louez's invoicing model. */
export const companyNumberSchemeValues = ["fr_siren", "be_bce"] as const;
export type CompanyNumberScheme = (typeof companyNumberSchemeValues)[number];

/** Users commonly paste national identifiers with spaces or punctuation. */
export const digitsOnly = (value: string): string => value.replace(/\D/g, "");

/** The scheme comes from the buyer's country and is never trusted from input. */
export const resolveCompanyNumberScheme = (country: string): CompanyNumberScheme | null => {
  if (country === "FR") return "fr_siren";
  if (country === "BE") return "be_bce";
  return null;
};

export const isValidCompanyNumber = (country: string, companyNumber: string): boolean => {
  const value = companyNumber.trim();
  if (value.length === 0 || value.length > 64) return false;
  if (country === "FR") return digitsOnly(value).length === 9;
  if (country === "BE") return digitsOnly(value).length === 10;
  return true;
};

export const isPlausibleVatNumber = (country: string, vatNumber: string): boolean => {
  const normalized = vatNumber.replace(/\s/g, "").toUpperCase();
  if (normalized.length === 0) return true;
  if (country === "FR") return /^FR[0-9A-Z]{11}$/.test(normalized);
  if (country === "BE") return /^BE\d{10}$/.test(normalized);
  return /^[A-Z]{2}[0-9A-Z]{2,15}$/.test(normalized);
};
