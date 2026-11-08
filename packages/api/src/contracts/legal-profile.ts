import { companySearchSchema, vatRegimeValues } from "@louez/validations";
import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * The store's legal identity (`store_legal_profiles`): who runs the store, as
 * invoices, contracts and the legal notice name it, and its electronic
 * invoicing switches. Also the French company registry an agent looks the
 * company up in. No database here.
 */

export const legalProfileView = z.object({
  legalName: z.string(),
  legalForm: z.string(),
  /** The SIREN in France (9 digits), the BCE number in Belgium. */
  companyNumber: z.string(),
  companyNumberScheme: z.enum(["fr_siren", "be_bce"]).nullable(),
  siret: z.string().nullable(),
  vatNumber: z.string().nullable(),
  rcsCity: z.string().nullable(),
  /** A decimal string in the store's currency. */
  shareCapital: z.string().nullable(),
  registeredAddress: z.string(),
  registeredAddressComplement: z.string().nullable(),
  registeredPostalCode: z.string(),
  registeredCity: z.string(),
  /** ISO 3166-1 alpha-2. */
  country: z.string(),
  invoicingEnabled: z.boolean(),
  vatRegime: z.enum(vatRegimeValues).nullable(),
  hasVatOnDebits: z.boolean(),
  updatedAt: z.string(),
});
export type LegalProfileView = z.infer<typeof legalProfileView>;

export const getLegalProfileInput = z.object({});

export const getLegalProfileOutput = z.object({
  /** Null until the store saved one. */
  profile: legalProfileView.nullable(),
  links: resourceLinksSchema,
});

const text = (max: number) => z.string().trim().max(max);
const required = (max: number, description: string) =>
  text(max).min(1).optional().describe(description);
const optional = (max: number, description: string) =>
  text(max).nullable().optional().describe(`${description} null clears it.`);

export const upsertLegalProfileInput = z.object({
  legalName: required(255, "The company's legal name (raison sociale), or the sole trader's name."),
  legalForm: required(100, "The legal form, such as SAS, SARL, Entrepreneur individuel."),
  companyNumber: required(
    64,
    "The company number: the SIREN in France (9 digits), the BCE number in Belgium.",
  ),
  siret: optional(20, "The SIRET of the establishment (14 digits), in France."),
  vatNumber: optional(64, "The intra-community VAT number (FR + 11 characters in France)."),
  rcsCity: optional(255, "The city of the trade register (RCS) the company is registered at."),
  shareCapital: optional(20, "The share capital, as a decimal string (1000.00)."),
  registeredAddress: required(255, "The registered office's street address."),
  registeredAddressComplement: optional(255, "A second address line."),
  registeredPostalCode: required(20, "The registered office's postal code."),
  registeredCity: required(255, "The registered office's city."),
  country: z
    .string()
    .trim()
    .length(2)
    .optional()
    .describe("Where the company is registered, as ISO 3166-1 alpha-2 (FR)."),
  invoicingEnabled: z
    .boolean()
    .optional()
    .describe(
      "Whether Louez issues the store's invoices as legal electronic invoices. Needs vatRegime.",
    ),
  vatRegime: z
    .enum(vatRegimeValues)
    .nullable()
    .optional()
    .describe("How often the company declares VAT; it sets the e-reporting calendar."),
  hasVatOnDebits: z
    .boolean()
    .optional()
    .describe("Whether the company opted for VAT on debits (TVA sur les débits)."),
});
export type UpsertLegalProfileInput = z.infer<typeof upsertLegalProfileInput>;

export const upsertLegalProfileOutput = z.object({
  profile: legalProfileView,
  links: resourceLinksSchema,
});

export const searchCompanyRegistryInput = z.object({
  query: companySearchSchema.shape.query.describe(
    "A company name, a SIREN (9 digits) or a SIRET (14 digits); 3 characters at least.",
  ),
});

export const companyRegistryResult = z.object({
  siren: z.string(),
  siret: z.string(),
  legalName: z.string(),
  legalForm: z.string(),
  vatNumber: z.string(),
  address: z.string(),
  addressComplement: z.string(),
  postalCode: z.string(),
  city: z.string(),
  rcsCity: z.string(),
  /** False for a company the registry lists as closed. */
  isActive: z.boolean(),
});

export const searchCompanyRegistryOutput = z.object({
  /** False when the registry could not answer: ask the user for the identity instead. */
  available: z.boolean(),
  results: z.array(companyRegistryResult),
});

/** A field the profile cannot be saved with, and why. */
export interface LegalProfileProblem {
  field: string;
  problem: "required" | "format";
}

const PROBLEM_HELP: Record<string, string> = {
  companyNumber: "a SIREN has 9 digits in France, a BCE number 10 in Belgium",
  siret: "a SIRET has 14 digits",
  shareCapital: "a decimal amount, such as 1000.00",
  vatRegime: "electronic invoicing needs the VAT regime",
};

export const legalProfileErrors = {
  invalid: (problems: readonly LegalProfileProblem[]) =>
    apiError("BAD_REQUEST", "LEGAL_PROFILE_INVALID", {
      message: `The legal profile cannot be saved: ${problems
        .map(({ field, problem }) =>
          problem === "required"
            ? `${field} is required`
            : `${field} is not valid (${PROBLEM_HELP[field] ?? "check its format"})`,
        )
        .join(
          "; ",
        )}. Look the company up with settings_search_company_registry to get its exact identity.`,
      i18nKey: "errors.invalidData",
      details: { problems },
    }),
} as const;
