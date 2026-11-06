import {
  CUSTOMER_FIELD_APPLIES_TO,
  CUSTOMER_FIELD_FORMATS,
  CUSTOMER_FIELD_TYPES,
  CUSTOMER_PROFILE_FIELD_VISIBILITIES,
  type CustomerFieldDefinition,
  type CustomerFieldFormat,
  type CustomerFieldValues,
} from "@louez/types";
import { z } from "zod";

import { isValidIdentityValue, normalizeIdentityValue } from "./identity-formats";
import { isPossiblePhoneNumberInput } from "./phone";

/** Guard rails of the editor: a record stays readable and a search stays an index seek. */
export const CUSTOMER_FIELD_LIMITS = {
  activeFields: 30,
  searchableFields: 5,
  listFields: 2,
  options: 50,
} as const;

const CUSTOMER_FIELD_VALUE_MAX_LENGTH = 2000;

export const customerFieldTypeSchema = z.enum(CUSTOMER_FIELD_TYPES);
export const customerFieldFormatSchema = z.enum(CUSTOMER_FIELD_FORMATS);
export const customerFieldAppliesToSchema = z.enum(CUSTOMER_FIELD_APPLIES_TO);

export const customerFieldDefinitionSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  type: customerFieldTypeSchema,
  format: customerFieldFormatSchema.nullable(),
  options: z.array(z.string()).nullable(),
  unit: z.string().nullable(),
  helpText: z.string().nullable(),
  section: z.string(),
  position: z.number(),
  appliesTo: customerFieldAppliesToSchema,
  isRequired: z.boolean(),
  isSensitive: z.boolean(),
  showOnContract: z.boolean(),
  isSearchable: z.boolean(),
  showInList: z.boolean(),
  templateKey: z.string().nullable(),
  isActive: z.boolean(),
});

const customerFieldBaseInputSchema = z.object({
  label: z.string().trim().min(1).max(100),
  type: customerFieldTypeSchema,
  format: customerFieldFormatSchema.nullish(),
  options: z.array(z.string().trim().min(1).max(100)).max(CUSTOMER_FIELD_LIMITS.options).nullish(),
  unit: z.string().trim().max(32).nullish(),
  helpText: z.string().trim().max(255).nullish(),
  section: z.string().trim().min(1).max(100),
  appliesTo: customerFieldAppliesToSchema.default("all"),
  isRequired: z.boolean().default(false),
  isSensitive: z.boolean().default(false),
  showOnContract: z.boolean().default(false),
  isSearchable: z.boolean().default(false),
  showInList: z.boolean().default(false),
});

const refineFieldShape = (
  field: { type: string; options?: string[] | null; format?: string | null },
  ctx: z.RefinementCtx,
) => {
  if (field.type === "select" && (field.options?.length ?? 0) === 0) {
    ctx.addIssue({ code: "custom", message: "errors.optionsRequired", path: ["options"] });
  }
  if (field.format && field.type !== "text") {
    ctx.addIssue({ code: "custom", message: "errors.invalidData", path: ["format"] });
  }
};

export const customerFieldCreateInputSchema = customerFieldBaseInputSchema
  .extend({
    /** Stable key of a template field; derived from the label when absent. */
    key: z.string().trim().min(1).max(64).optional(),
    templateKey: z.string().trim().max(64).nullish(),
  })
  .superRefine(refineFieldShape);

export type CustomerFieldCreateInput = z.infer<typeof customerFieldCreateInputSchema>;

/** The type is fixed once a field exists: stored values would stop making sense. */
export const customerFieldUpdateInputSchema = customerFieldBaseInputSchema
  .omit({ type: true })
  .partial()
  .extend({ id: z.string().length(21) });

export const customerFieldReorderInputSchema = z.object({
  /** Every active field in its new order, grouped by section. */
  fields: z
    .array(z.object({ id: z.string().length(21), section: z.string().trim().min(1).max(100) }))
    .max(200),
});

export const customerFieldTemplateAdoptInputSchema = z.object({
  templateKey: z.string().trim().min(1).max(64),
  fields: z.array(customerFieldCreateInputSchema).min(1).max(20),
});

export const customerProfileSettingsSchema = z.object({
  birthDate: z.enum(CUSTOMER_PROFILE_FIELD_VISIBILITIES).optional(),
  acquisitionSource: z.enum(CUSTOMER_PROFILE_FIELD_VISIBILITIES).optional(),
  socialLinks: z.enum(["hidden", "optional"]).optional(),
});

export const customerFieldValuesSchema = z.record(
  z.string().max(21),
  z.string().max(CUSTOMER_FIELD_VALUE_MAX_LENGTH),
);

// ----------------------------------------------------------------------------
// Values
// ----------------------------------------------------------------------------

/** Lowercased with everything but letters and digits removed: "529.982.247-25" and "52998224725" match. */
export function toCustomerFieldSearchValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 191);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isRealIsoDate = (value: string) => {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export type CustomerFieldIssueCode =
  | "required"
  | "invalidNumber"
  | "invalidDate"
  | "invalidOption"
  | "invalidEmail"
  | "invalidPhone"
  | "invalidUrl";

export interface CustomerFieldIssue {
  definitionId: string;
  code: CustomerFieldIssueCode;
}

type FieldShape = Pick<
  CustomerFieldDefinition,
  "id" | "type" | "format" | "options" | "isRequired" | "appliesTo" | "isActive"
>;

/** The stored form of one value, or the reason it cannot be stored. Empty input is an empty string. */
export function normalizeCustomerFieldValue(
  field: Pick<FieldShape, "type" | "format" | "options">,
  input: string | null | undefined,
): { value: string } | { code: CustomerFieldIssueCode } {
  const raw = input?.trim() ?? "";
  if (raw === "") return { value: "" };

  switch (field.type) {
    case "checkbox":
      return { value: raw === "true" ? "true" : "" };
    case "number": {
      const normalized = raw.replace(/\s/g, "").replace(",", ".");
      return /^-?\d+(\.\d+)?$/.test(normalized) ? { value: normalized } : { code: "invalidNumber" };
    }
    case "date":
      return isRealIsoDate(raw) ? { value: raw } : { code: "invalidDate" };
    case "select":
      return field.options?.includes(raw) ? { value: raw } : { code: "invalidOption" };
    case "email":
      return z.email().safeParse(raw).success
        ? { value: raw.toLowerCase() }
        : { code: "invalidEmail" };
    case "phone":
      return isPossiblePhoneNumberInput(raw) ? { value: raw } : { code: "invalidPhone" };
    case "url": {
      const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
      return z.url().safeParse(candidate).success ? { value: candidate } : { code: "invalidUrl" };
    }
    case "text":
      return { value: field.format ? normalizeIdentityValue(field.format, raw) : raw };
    case "textarea":
      return { value: raw };
  }
}

const appliesToCustomer = (field: Pick<FieldShape, "appliesTo">, customerType: string) =>
  field.appliesTo === "all" || field.appliesTo === customerType;

/**
 * Checks submitted values against the store's definitions. Values of unknown,
 * archived or non-applicable fields are dropped rather than rejected, so a
 * stale form never blocks a save. An empty string means "clear the value".
 */
export function validateCustomerFieldValues(params: {
  definitions: readonly FieldShape[];
  values: CustomerFieldValues | null | undefined;
  customerType: "individual" | "business";
  /** A partial update only checks the fields it carries. */
  partial?: boolean;
}): { values: CustomerFieldValues; issues: CustomerFieldIssue[] } {
  const values: CustomerFieldValues = {};
  const issues: CustomerFieldIssue[] = [];

  for (const field of params.definitions) {
    if (!field.isActive || !appliesToCustomer(field, params.customerType)) continue;
    const submitted = params.values?.[field.id];
    if (submitted === undefined && params.partial) continue;

    const result = normalizeCustomerFieldValue(field, submitted);
    if ("code" in result) {
      issues.push({ definitionId: field.id, code: result.code });
      continue;
    }
    if (result.value === "" && field.isRequired) {
      issues.push({ definitionId: field.id, code: "required" });
      continue;
    }
    values[field.id] = result.value;
  }

  return { values, issues };
}

/** True when a formatted identifier fails its control digits: worth a warning, never a refusal. */
export function hasSuspiciousIdentityValue(
  format: CustomerFieldFormat | null | undefined,
  value: string,
): boolean {
  if (!format || value.trim() === "") return false;
  return !isValidIdentityValue(format, value);
}
