import {
  CUSTOMER_FIELD_APPLIES_TO,
  CUSTOMER_FIELD_COLLECT_MODES,
  CUSTOMER_FIELD_FORMATS,
  CUSTOMER_FIELD_SCOPES,
  CUSTOMER_FIELD_TARGET_MODES,
  CUSTOMER_FIELD_TARGET_TYPES,
  CUSTOMER_FIELD_TYPES,
  CUSTOMER_FIELD_WIDTHS,
  CUSTOMER_PROFILE_FIELD_KEYS,
  type CustomerFieldCollectMode,
  type CustomerFieldDefinition,
  type CustomerFieldFormat,
  type CustomerFieldType,
  type CustomerFieldValues,
  type CustomerFieldWidth,
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
  /** Categories and products one field can be limited to. */
  targets: 100,
} as const;

const CUSTOMER_FIELD_VALUE_MAX_LENGTH = 2000;

export const customerFieldTypeSchema = z.enum(CUSTOMER_FIELD_TYPES);
export const customerFieldFormatSchema = z.enum(CUSTOMER_FIELD_FORMATS);
export const customerFieldAppliesToSchema = z.enum(CUSTOMER_FIELD_APPLIES_TO);
export const customerFieldScopeSchema = z.enum(CUSTOMER_FIELD_SCOPES);
export const customerFieldCollectModeSchema = z.enum(CUSTOMER_FIELD_COLLECT_MODES);
export const customerFieldTargetModeSchema = z.enum(CUSTOMER_FIELD_TARGET_MODES);
export const customerFieldWidthSchema = z.enum(CUSTOMER_FIELD_WIDTHS);

/** A new field takes half a row, next to another; a long text takes the whole row. */
export const defaultCustomerFieldWidth = (type: CustomerFieldType): CustomerFieldWidth =>
  type === "textarea" ? "full" : "half";

export const customerFieldTargetSchema = z.object({
  type: z.enum(CUSTOMER_FIELD_TARGET_TYPES),
  id: z.string().trim().min(1).max(21),
});

export const customerFieldTargetsInputSchema = z
  .array(customerFieldTargetSchema)
  .max(CUSTOMER_FIELD_LIMITS.targets);

export const customerFieldDefinitionSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  type: customerFieldTypeSchema,
  format: customerFieldFormatSchema.nullable(),
  options: z.array(z.string()).nullable(),
  unit: z.string().nullable(),
  helpText: z.string().nullable(),
  /** @deprecated Read by the settings page being rebuilt only; nothing groups by it. */
  section: z.string(),
  position: z.number(),
  width: customerFieldWidthSchema,
  appliesTo: customerFieldAppliesToSchema,
  isRequired: z.boolean(),
  isSensitive: z.boolean(),
  showOnContract: z.boolean(),
  isSearchable: z.boolean(),
  showInList: z.boolean(),
  templateKey: z.string().nullable(),
  isActive: z.boolean(),
  scope: customerFieldScopeSchema,
  collectMode: customerFieldCollectModeSchema,
  targetMode: customerFieldTargetModeSchema,
  customerEditable: z.boolean(),
  targets: z.array(customerFieldTargetSchema),
});

/**
 * What the owner edits on a field, without defaults: `.partial()` keeps a
 * default applying to an omitted key, so an update built on defaults would
 * reset every switch it does not carry.
 */
const customerFieldEditableShape = {
  label: z.string().trim().min(1).max(100),
  format: customerFieldFormatSchema.nullish(),
  options: z.array(z.string().trim().min(1).max(100)).max(CUSTOMER_FIELD_LIMITS.options).nullish(),
  unit: z.string().trim().max(32).nullish(),
  helpText: z.string().trim().max(255).nullish(),
  appliesTo: customerFieldAppliesToSchema,
  isRequired: z.boolean(),
  isSensitive: z.boolean(),
  showOnContract: z.boolean(),
  isSearchable: z.boolean(),
  showInList: z.boolean(),
  collectMode: customerFieldCollectModeSchema,
  targetMode: customerFieldTargetModeSchema,
  /** Replace-all. Stored as sent; only read while `targetMode` is `products`. */
  targets: customerFieldTargetsInputSchema,
  customerEditable: z.boolean(),
};

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

/** Switches that only make sense on the customer record. */
const CUSTOMER_ONLY_FLAGS = ["isRequired", "isSearchable", "showInList"] as const;

/**
 * An item-scope value lives on a rented unit, not on the customer record: the
 * team never has to fill it to save a customer, it is neither searched nor
 * listed, and it concerns every customer type.
 */
export const refineCustomerFieldScopeFlags = (
  field: {
    scope?: string;
    appliesTo?: string;
    isRequired?: boolean;
    isSearchable?: boolean;
    showInList?: boolean;
  },
  ctx: z.RefinementCtx,
) => {
  if (field.scope !== "item") return;
  for (const flag of CUSTOMER_ONLY_FLAGS) {
    if (field[flag]) ctx.addIssue({ code: "custom", message: "errors.invalidData", path: [flag] });
  }
  if (field.appliesTo !== undefined && field.appliesTo !== "all") {
    ctx.addIssue({ code: "custom", message: "errors.invalidData", path: ["appliesTo"] });
  }
};

/** A customer can only edit, from their account, a field the checkout asks them. */
const refineOnlineSettings = (
  field: { collectMode?: CustomerFieldCollectMode; customerEditable?: boolean },
  ctx: z.RefinementCtx,
) => {
  if (field.customerEditable && field.collectMode === "never") {
    ctx.addIssue({ code: "custom", message: "errors.invalidData", path: ["customerEditable"] });
  }
};

export const customerFieldCreateInputSchema = z
  .object({
    ...customerFieldEditableShape,
    type: customerFieldTypeSchema,
    /** Fixed at creation, like the type. */
    scope: customerFieldScopeSchema.default("customer"),
    appliesTo: customerFieldAppliesToSchema.default("all"),
    isRequired: z.boolean().default(false),
    isSensitive: z.boolean().default(false),
    showOnContract: z.boolean().default(false),
    isSearchable: z.boolean().default(false),
    showInList: z.boolean().default(false),
    collectMode: customerFieldCollectModeSchema.default("never"),
    targetMode: customerFieldTargetModeSchema.default("all"),
    targets: customerFieldTargetsInputSchema.default([]),
    customerEditable: z.boolean().default(false),
    /**
     * Its width in the layout; `defaultCustomerFieldWidth(type)` when absent.
     * A new field always lands at the end of its scope's layout; moving it
     * and resizing it later go through `updateLayout`.
     */
    width: customerFieldWidthSchema.optional(),
    /** Stable key of a template field; derived from the label when absent. */
    key: z.string().trim().min(1).max(64).optional(),
    templateKey: z.string().trim().max(64).nullish(),
  })
  .superRefine((field, ctx) => {
    refineFieldShape(field, ctx);
    refineCustomerFieldScopeFlags(field, ctx);
    refineOnlineSettings(field, ctx);
  });

export type CustomerFieldCreateInput = z.infer<typeof customerFieldCreateInputSchema>;

/**
 * Only the keys it carries change. The type and the scope are fixed once a
 * field exists: stored values would stop making sense. Scope-dependent rules
 * are checked by the server against the stored field.
 */
export const customerFieldUpdateInputSchema = z
  .object(customerFieldEditableShape)
  .partial()
  .extend({ id: z.string().length(21), isActive: z.boolean().optional() })
  .superRefine(refineOnlineSettings);

export type CustomerFieldUpdateInput = z.infer<typeof customerFieldUpdateInputSchema>;

/**
 * The online settings a field ends up with once a patch applies, or null when
 * the patch is incoherent. Turning "ask the customer" off takes the customer's
 * edit right with it; granting that right on a field never asked is refused.
 */
export function mergeCustomerFieldOnlineSettings(
  current: { collectMode: CustomerFieldCollectMode; customerEditable: boolean },
  patch: { collectMode?: CustomerFieldCollectMode; customerEditable?: boolean },
): { collectMode: CustomerFieldCollectMode; customerEditable: boolean } | null {
  const collectMode = patch.collectMode ?? current.collectMode;
  if (collectMode === "never") {
    return patch.customerEditable ? null : { collectMode, customerEditable: false };
  }
  return { collectMode, customerEditable: patch.customerEditable ?? current.customerEditable };
}

export const customerFieldTemplateAdoptInputSchema = z.object({
  templateKey: z.string().trim().min(1).max(64),
  fields: z.array(customerFieldCreateInputSchema).min(1).max(20),
});

/** Birth date, customer source, social links: the native fields of every customer record. */
export const customerProfileFieldKeySchema = z.enum(CUSTOMER_PROFILE_FIELD_KEYS);

export const customerFieldValuesSchema = z.record(
  z.string().max(21),
  z.string().max(CUSTOMER_FIELD_VALUE_MAX_LENGTH),
);

/** Values sent by a storefront visitor: no more keys than a store can have fields. */
export const customerFieldSubmittedValuesSchema = customerFieldValuesSchema.refine(
  (values) => Object.keys(values).length <= CUSTOMER_FIELD_LIMITS.activeFields,
  "errors.invalidData",
);

const PARTICIPANT_NAME_MAX_LENGTH = 100;

/** One rented unit as the checkout sends it: its position in `units` is its unit index. */
export const checkoutItemDetailUnitSchema = z.object({
  /** "Pour qui ?"; blank reads as absent. */
  participantName: z.string().trim().max(PARTICIPANT_NAME_MAX_LENGTH).optional(),
  values: customerFieldSubmittedValuesSchema,
});

/** Item-scope values of the checkout, by cart line (`lineIndex` = index in `items`). */
export const checkoutItemDetailsSchema = z
  .array(
    z.object({
      lineIndex: z.number().int().min(0).max(49),
      units: z.array(checkoutItemDetailUnitSchema).max(999),
    }),
  )
  .max(50);

export type CheckoutItemDetailsInput = z.infer<typeof checkoutItemDetailsSchema>;

export const reservationItemDetailSchema = z.object({
  unitIndex: z.number().int(),
  participantName: z.string().nullable(),
  values: customerFieldValuesSchema,
});

/**
 * Edits of the units of a reservation's items. Each unit listed is replaced
 * for the fields the caller may write; units left out are untouched.
 */
export const reservationItemDetailsUpdateInputSchema = z.object({
  reservationId: z.string().min(1).max(21),
  items: z
    .array(
      z.object({
        reservationItemId: z.string().min(1).max(21),
        units: z
          .array(
            z.object({
              unitIndex: z.number().int().min(0).max(998),
              participantName: z.string().trim().max(PARTICIPANT_NAME_MAX_LENGTH).nullish(),
              values: customerFieldSubmittedValuesSchema,
            }),
          )
          .max(999),
      }),
    )
    .min(1)
    .max(50),
});

export type ReservationItemDetailsUpdateInput = z.infer<
  typeof reservationItemDetailsUpdateInputSchema
>;

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

export const CUSTOMER_FIELD_ISSUE_CODES = [
  "required",
  "invalidNumber",
  "invalidDate",
  "invalidOption",
  "invalidEmail",
  "invalidPhone",
  "invalidUrl",
] as const;

export type CustomerFieldIssueCode = (typeof CUSTOMER_FIELD_ISSUE_CODES)[number];

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
