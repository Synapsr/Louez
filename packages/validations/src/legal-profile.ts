import { z } from "zod";

/** Company-number schemes understood by the PDP network (mirrors the DB enum). */
export const companyNumberSchemeValues = ["fr_siren", "be_bce"] as const;
export type CompanyNumberScheme = (typeof companyNumberSchemeValues)[number];

/** VAT declaration rhythm — drives the e-reporting calendar of the PDP. */
export const vatRegimeValues = ["monthly", "quarterly", "simplified", "vat_exemption"] as const;
export type VatRegime = (typeof vatRegimeValues)[number];

/** Countries whose legal identity can later be enrolled for PDP transmission. */
export const pdpSupportedCountries = ["FR", "BE"] as const;

const SIREN_LENGTH = 9;
const SIRET_LENGTH = 14;
const BCE_LENGTH = 10;

/** Keep only the digits of a company/VAT identifier (users paste spaced values). */
export const digitsOnly = (value: string): string => value.replace(/\D/g, "");

/** FR companies are identified by their SIREN, BE ones by their BCE number. */
export const resolveCompanyNumberScheme = (country: string): CompanyNumberScheme | null => {
  if (country === "FR") return "fr_siren";
  if (country === "BE") return "be_bce";
  return null;
};

/**
 * Lenient VAT-number shape check.
 *
 * Used to warn the merchant, never to block a save: VAT numbers have many
 * national variants and a wrong-looking value is often a legitimate one.
 */
export const isPlausibleVatNumber = (country: string, vatNumber: string): boolean => {
  const normalized = vatNumber.replace(/\s/g, "").toUpperCase();
  if (normalized.length === 0) return true;
  if (country === "FR") return /^FR[0-9A-Z]{11}$/.test(normalized);
  if (country === "BE") return /^BE\d{10}$/.test(normalized);
  return /^[A-Z]{2}[0-9A-Z]{2,15}$/.test(normalized);
};

/** Share capital is stored as a `decimal(10,2)` string — accept `1234,50` too. */
export const normalizeShareCapital = (value: string): string | null => {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (normalized.length === 0) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed.toFixed(2);
};

type TranslateFn = (key: string, params?: Record<string, string | number | Date>) => string;

const buildStoreLegalProfileSchema = (t: TranslateFn) =>
  z
    .object({
      legalName: z
        .string()
        .trim()
        .min(1, t("required"))
        .max(255, t("maxLength", { max: 255 })),
      legalForm: z
        .string()
        .trim()
        .min(1, t("required"))
        .max(100, t("maxLength", { max: 100 })),
      companyNumber: z
        .string()
        .trim()
        .min(1, t("required"))
        .max(64, t("maxLength", { max: 64 })),
      siret: z
        .string()
        .trim()
        .max(20, t("maxLength", { max: 20 })),
      vatNumber: z
        .string()
        .trim()
        .max(64, t("maxLength", { max: 64 })),
      rcsCity: z
        .string()
        .trim()
        .max(255, t("maxLength", { max: 255 })),
      shareCapital: z
        .string()
        .trim()
        .max(20, t("maxLength", { max: 20 })),
      registeredAddress: z
        .string()
        .trim()
        .min(1, t("required"))
        .max(255, t("maxLength", { max: 255 })),
      registeredAddressComplement: z
        .string()
        .trim()
        .max(255, t("maxLength", { max: 255 })),
      registeredPostalCode: z
        .string()
        .trim()
        .min(1, t("required"))
        .max(20, t("maxLength", { max: 20 })),
      registeredCity: z
        .string()
        .trim()
        .min(1, t("required"))
        .max(255, t("maxLength", { max: 255 })),
      country: z
        .string()
        .trim()
        .length(2, t("minLength", { min: 2 })),
      invoicingEnabled: z.boolean(),
      vatRegime: z.enum(vatRegimeValues).nullable(),
      hasVatOnDebits: z.boolean(),
    })
    .superRefine((data, ctx) => {
      if (data.country === "FR" && digitsOnly(data.companyNumber).length !== SIREN_LENGTH) {
        ctx.addIssue({
          code: "custom",
          message: t("invalidFormat"),
          path: ["companyNumber"],
        });
      }

      if (data.country === "BE" && digitsOnly(data.companyNumber).length !== BCE_LENGTH) {
        ctx.addIssue({
          code: "custom",
          message: t("invalidFormat"),
          path: ["companyNumber"],
        });
      }

      if (data.siret.length > 0 && digitsOnly(data.siret).length !== SIRET_LENGTH) {
        ctx.addIssue({
          code: "custom",
          message: t("invalidFormat"),
          path: ["siret"],
        });
      }

      if (data.shareCapital.length > 0 && normalizeShareCapital(data.shareCapital) === null) {
        ctx.addIssue({
          code: "custom",
          message: t("invalidFormat"),
          path: ["shareCapital"],
        });
      }

      // The PDP needs the declaration rhythm to derive the e-reporting calendar.
      if (data.invoicingEnabled && data.vatRegime === null) {
        ctx.addIssue({
          code: "custom",
          message: t("required"),
          path: ["vatRegime"],
        });
      }
    });

/** Schema factory for forms — messages are already translated. */
export const createStoreLegalProfileSchema = (t: TranslateFn) => buildStoreLegalProfileSchema(t);

/** Server-side schema — messages are translation keys the client resolves. */
export const storeLegalProfileSchema = buildStoreLegalProfileSchema((key) => `validation.${key}`);

export type StoreLegalProfileInput = z.infer<typeof storeLegalProfileSchema>;

export const companySearchSchema = z.object({
  query: z.string().trim().min(3).max(120),
});

export type CompanySearchInput = z.infer<typeof companySearchSchema>;
