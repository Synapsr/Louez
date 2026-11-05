import type {
  CustomerFieldDefinition,
  CustomerFieldValues,
  ReservationItemDetail,
} from "@louez/types";
import { z } from "zod";

import {
  CUSTOMER_FIELD_ISSUE_CODES,
  customerFieldAppliesToSchema,
  customerFieldCollectModeSchema,
  customerFieldFormatSchema,
  customerFieldScopeSchema,
  customerProfileFieldKeySchema,
  customerFieldTypeSchema,
  customerFieldWidthSchema,
  normalizeCustomerFieldValue,
  type CustomerFieldIssueCode,
} from "./customer-fields";

// ----------------------------------------------------------------------------
// Targeting: which fields concern which products
// ----------------------------------------------------------------------------

/** A product as the resolver sees it: its id and every category it belongs to (primary and extra). */
export interface CustomerFieldProduct {
  id: string;
  categoryIds: readonly string[];
}

type TargetedField = Pick<CustomerFieldDefinition, "isActive" | "targetMode" | "targets">;

type ResolvableField = TargetedField &
  Pick<CustomerFieldDefinition, "scope" | "collectMode" | "appliesTo">;

/**
 * `all` concerns every product; `products` concerns a targeted product or a
 * product in a targeted category. An archived field concerns nothing.
 */
export const fieldAppliesToProduct = (
  definition: TargetedField,
  product: CustomerFieldProduct,
): boolean => {
  if (!definition.isActive) return false;
  if (definition.targetMode === "all") return true;
  return definition.targets.some((target) =>
    target.type === "product" ? target.id === product.id : product.categoryIds.includes(target.id),
  );
};

/** Item-scope fields recorded on the units of this product, whether the checkout asks them or not. */
export const itemFieldsForProduct = <TField extends ResolvableField>(
  definitions: readonly TField[],
  product: CustomerFieldProduct,
): TField[] =>
  definitions.filter(
    (definition) => definition.scope === "item" && fieldAppliesToProduct(definition, product),
  );

export interface CheckoutFieldsCartLine {
  productId: string;
  categoryIds: readonly string[];
  quantity: number;
}

export interface ResolvedCheckoutFields<TField> {
  /** Asked once, on the contact step. */
  customerFields: TField[];
  /** Asked per rented unit, same order as the cart lines. */
  lines: { itemFields: TField[] }[];
}

/**
 * What the checkout asks for this cart, definitions order kept (the layout's
 * order when they come from `listCustomerFieldDefinitions`). A customer field
 * is asked when one line concerns it and it applies to the buyer's type; an
 * item field is asked on the units of the lines it concerns.
 */
export const resolveCheckoutFields = <TField extends ResolvableField>(
  definitions: readonly TField[],
  lines: readonly CheckoutFieldsCartLine[],
  customerType: "individual" | "business",
): ResolvedCheckoutFields<TField> => {
  const asked = definitions.filter(
    (definition) => definition.isActive && definition.collectMode !== "never",
  );
  const products = lines.map((line) => ({ id: line.productId, categoryIds: line.categoryIds }));

  return {
    customerFields: asked.filter(
      (definition) =>
        definition.scope === "customer" &&
        (definition.appliesTo === "all" || definition.appliesTo === customerType) &&
        products.some((product) => fieldAppliesToProduct(definition, product)),
    ),
    lines: products.map((product) => ({ itemFields: itemFieldsForProduct(asked, product) })),
  };
};

/** True when the checkout needs its "Détails de la location" step. */
export const hasCheckoutItemFields = (resolved: {
  lines: readonly { itemFields: readonly unknown[] }[];
}): boolean => resolved.lines.some((line) => line.itemFields.length > 0);

// ----------------------------------------------------------------------------
// What a customer may see of a field
// ----------------------------------------------------------------------------

/** A field as the storefront shows it: never its targets or the team-only switches. */
export const customerFieldPublicSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: customerFieldTypeSchema,
  format: customerFieldFormatSchema.nullable(),
  options: z.array(z.string()).nullable(),
  unit: z.string().nullable(),
  helpText: z.string().nullable(),
  position: z.number(),
  /** Half a row next to another field, or the whole row: forms honour it. */
  width: customerFieldWidthSchema,
  scope: customerFieldScopeSchema,
  collectMode: customerFieldCollectModeSchema,
  isSensitive: z.boolean(),
});

export type CustomerFieldPublic = z.infer<typeof customerFieldPublicSchema>;

/** A field of the customer's own account: they also need to know who it concerns and whether they may edit it. */
export const customerFieldAccountSchema = customerFieldPublicSchema.extend({
  appliesTo: customerFieldAppliesToSchema,
  customerEditable: z.boolean(),
});

export type CustomerFieldAccount = z.infer<typeof customerFieldAccountSchema>;

export const toPublicCustomerField = (
  definition: CustomerFieldDefinition,
): CustomerFieldPublic => ({
  id: definition.id,
  label: definition.label,
  type: definition.type,
  format: definition.format,
  options: definition.options,
  unit: definition.unit,
  helpText: definition.helpText,
  position: definition.position,
  width: definition.width,
  scope: definition.scope,
  collectMode: definition.collectMode,
  isSensitive: definition.isSensitive,
});

export const toAccountCustomerField = (
  definition: CustomerFieldDefinition,
): CustomerFieldAccount => ({
  ...toPublicCustomerField(definition),
  appliesTo: definition.appliesTo,
  customerEditable: definition.customerEditable,
});

// ----------------------------------------------------------------------------
// Checkout values
// ----------------------------------------------------------------------------

type ValidationField = Pick<
  CustomerFieldDefinition,
  "id" | "type" | "format" | "options" | "collectMode"
>;

export interface CheckoutFieldsToValidate<TField extends ValidationField> {
  customerFields: readonly TField[];
  /** Cart order: the `lineIndex` of a submission is an index here. */
  lines: readonly { quantity: number; itemFields: readonly TField[] }[];
}

const customerFieldIssueCodeSchema = z.enum(CUSTOMER_FIELD_ISSUE_CODES);

/**
 * Where a checkout value went wrong: a native profile field, a customer
 * field, or a field of one unit of one line.
 */
export const checkoutFieldIssueSchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("profile"),
    field: customerProfileFieldKeySchema,
    code: customerFieldIssueCodeSchema,
  }),
  z.object({
    target: z.literal("customer"),
    definitionId: z.string(),
    code: customerFieldIssueCodeSchema,
  }),
  z.object({
    target: z.literal("item"),
    lineIndex: z.number(),
    unitIndex: z.number(),
    definitionId: z.string(),
    code: customerFieldIssueCodeSchema,
  }),
]);

export type CheckoutFieldIssue = z.infer<typeof checkoutFieldIssueSchema>;

export interface CheckoutItemDetailsSubmission {
  lineIndex: number;
  /** Position in the array = unit index. */
  units: readonly { participantName?: string | null; values: CustomerFieldValues }[];
}

export interface ValidatedCheckoutFields {
  /** Asked customer fields that were submitted, normalised. "" asks to clear the value. */
  customerValues: CustomerFieldValues;
  /**
   * Every line that asks item fields, with each of its units in order, empty
   * ones included so a write can clear what an earlier attempt recorded.
   * Values only hold non-empty entries of asked fields.
   */
  itemDetails: { lineIndex: number; units: ReservationItemDetail[] }[];
  issues: CheckoutFieldIssue[];
}

const PARTICIPANT_NAME_MAX_LENGTH = 100;

/** "Pour qui ?" as stored: trimmed, capped, null when blank. */
export const normalizeParticipantName = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim().slice(0, PARTICIPANT_NAME_MAX_LENGTH) ?? "";
  return trimmed === "" ? null : trimmed;
};

/**
 * Checks checkout values against what the checkout asks. Values of fields
 * that were not asked are dropped, units beyond a line's quantity too.
 * A required customer field left out of the submission is satisfied by a
 * value already on file; an explicit blank is not.
 */
export function validateCheckoutFieldValues<TField extends ValidationField>(params: {
  fields: CheckoutFieldsToValidate<TField>;
  customerFields?: CustomerFieldValues | null;
  itemDetails?: readonly CheckoutItemDetailsSubmission[] | null;
  existingCustomerValues?: CustomerFieldValues | null;
}): ValidatedCheckoutFields {
  const issues: CheckoutFieldIssue[] = [];
  const customerValues: CustomerFieldValues = {};

  for (const field of params.fields.customerFields) {
    const submitted = params.customerFields?.[field.id];
    const result = normalizeCustomerFieldValue(field, submitted);
    if ("code" in result) {
      issues.push({ target: "customer", definitionId: field.id, code: result.code });
      continue;
    }
    const onFile = submitted === undefined && Boolean(params.existingCustomerValues?.[field.id]);
    if (result.value === "" && field.collectMode === "required" && !onFile) {
      issues.push({ target: "customer", definitionId: field.id, code: "required" });
      continue;
    }
    if (submitted !== undefined) customerValues[field.id] = result.value;
  }

  const submittedUnitsByLine = new Map(
    (params.itemDetails ?? []).map((line) => [line.lineIndex, line.units]),
  );
  const itemDetails: ValidatedCheckoutFields["itemDetails"] = [];

  params.fields.lines.forEach((line, lineIndex) => {
    if (line.itemFields.length === 0) return;
    const submittedUnits = submittedUnitsByLine.get(lineIndex) ?? [];
    const units: ReservationItemDetail[] = [];

    for (let unitIndex = 0; unitIndex < line.quantity; unitIndex += 1) {
      const submitted = submittedUnits[unitIndex];
      const values: CustomerFieldValues = {};
      for (const field of line.itemFields) {
        const result = normalizeCustomerFieldValue(field, submitted?.values[field.id]);
        if ("code" in result) {
          issues.push({
            target: "item",
            lineIndex,
            unitIndex,
            definitionId: field.id,
            code: result.code,
          });
        } else if (result.value !== "") {
          values[field.id] = result.value;
        } else if (field.collectMode === "required") {
          issues.push({
            target: "item",
            lineIndex,
            unitIndex,
            definitionId: field.id,
            code: "required",
          });
        }
      }
      units.push({
        unitIndex,
        participantName: normalizeParticipantName(submitted?.participantName),
        values,
      });
    }
    itemDetails.push({ lineIndex, units });
  });

  return { customerValues, itemDetails, issues };
}

// ----------------------------------------------------------------------------
// Editing recorded units (team from the dashboard, customer from their account)
// ----------------------------------------------------------------------------

export interface ItemDetailUnitIssue {
  unitIndex: number;
  definitionId: string;
  code: CustomerFieldIssueCode;
}

/**
 * `data.issues[]` of the BAD_REQUEST (`errors.customFieldsInvalid`) an item
 * details update answers when a value cannot be stored.
 */
export const reservationItemDetailIssueSchema = z.object({
  reservationItemId: z.string(),
  unitIndex: z.number(),
  definitionId: z.string(),
  code: customerFieldIssueCodeSchema,
});

export type ReservationItemDetailIssue = z.infer<typeof reservationItemDetailIssueSchema>;

/** `data.issues[]` of the BAD_REQUEST (`errors.customFieldsInvalid`) of `updateMyValues`. */
export const customerFieldIssueSchema = z.object({
  definitionId: z.string(),
  code: customerFieldIssueCodeSchema,
});

/**
 * Normalises edited units against the fields the editor may write. Each unit
 * listed is replaced for those fields: a key left out clears the value.
 * Units beyond the quantity and values of other fields are dropped. With
 * `enforceRequired` (the customer), a field asked as required cannot be emptied.
 */
export function validateItemDetailUnits<TField extends ValidationField>(params: {
  fields: readonly TField[];
  quantity: number;
  units: readonly {
    unitIndex: number;
    participantName?: string | null;
    values: CustomerFieldValues;
  }[];
  enforceRequired: boolean;
}): { units: ReservationItemDetail[]; issues: ItemDetailUnitIssue[] } {
  const issues: ItemDetailUnitIssue[] = [];
  const byIndex = new Map<number, ReservationItemDetail>();

  for (const unit of params.units) {
    if (unit.unitIndex < 0 || unit.unitIndex >= params.quantity) continue;
    const values: CustomerFieldValues = {};
    for (const field of params.fields) {
      const result = normalizeCustomerFieldValue(field, unit.values[field.id]);
      if ("code" in result) {
        issues.push({ unitIndex: unit.unitIndex, definitionId: field.id, code: result.code });
      } else if (result.value !== "") {
        values[field.id] = result.value;
      } else if (params.enforceRequired && field.collectMode === "required") {
        issues.push({ unitIndex: unit.unitIndex, definitionId: field.id, code: "required" });
      }
    }
    byIndex.set(unit.unitIndex, {
      unitIndex: unit.unitIndex,
      participantName: normalizeParticipantName(unit.participantName),
      values,
    });
  }

  return {
    units: [...byIndex.values()].sort((left, right) => left.unitIndex - right.unitIndex),
    issues,
  };
}

/** Reservation states in which a customer may still change what they recorded. */
const CUSTOMER_EDITABLE_RESERVATION_STATUSES: readonly string[] = ["pending", "confirmed"];

/**
 * A customer edits the details of their reservation until the rental starts;
 * an ongoing, finished, cancelled or refused reservation is history.
 */
export const canCustomerEditReservationDetails = (
  reservation: { status: string; startDate: Date },
  now: Date,
): boolean =>
  CUSTOMER_EDITABLE_RESERVATION_STATUSES.includes(reservation.status) &&
  reservation.startDate.getTime() > now.getTime();
