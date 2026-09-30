import type { CustomerFieldValues } from "@louez/types";
import {
  normalizeCustomerFieldValue,
  validateCheckoutFieldValues,
  type CheckoutFieldIssue,
  type CheckoutItemDetailsInput,
  type CustomerFieldIssueCode,
  type CustomerFieldPublic,
} from "@louez/validations";

import type { CheckoutFieldsPlan, CheckoutFormValues } from "./checkout.types";

export const EMPTY_CHECKOUT_FIELDS_PLAN: CheckoutFieldsPlan = { customerFields: [], lines: [] };

/**
 * Key of one rented unit in `itemDetails`. The cart line id survives an edit
 * of the cart where its index would not.
 */
export const toUnitKey = (lineId: string, unitIndex: number): string => `${lineId}~${unitIndex}`;

/** Form field names of the custom fields, as TanStack Form paths. */
export type CheckoutCustomerFieldName = `customerFields.${string}`;
export type CheckoutItemFieldName = `itemDetails.${string}.values.${string}`;
export type CheckoutParticipantFieldName = `itemDetails.${string}.participantName`;

export const toCustomerFieldName = (definitionId: string): CheckoutCustomerFieldName =>
  `customerFields.${definitionId}`;

export const toItemFieldName = (unitKey: string, definitionId: string): CheckoutItemFieldName =>
  `itemDetails.${unitKey}.values.${definitionId}`;

export const toParticipantFieldName = (unitKey: string): CheckoutParticipantFieldName =>
  `itemDetails.${unitKey}.participantName`;

interface ForCartAnswer {
  customerFields: CustomerFieldPublic[];
  lines: { productId: string; quantity: number; itemFields: CustomerFieldPublic[] }[];
}

interface PlanCartLine {
  lineId: string;
  productId: string;
  productName: string;
  productImage: string | null;
  quantity: number;
}

/**
 * Pairs `storefront.customerFields.forCart` with the cart lines. A line whose
 * answer is for another product (the cart changed while the answer was on its
 * way) asks nothing until the next answer; the server re-checks anyway.
 */
export const buildCheckoutFieldsPlan = (
  answer: ForCartAnswer | undefined,
  lines: readonly PlanCartLine[],
): CheckoutFieldsPlan => {
  if (!answer) return EMPTY_CHECKOUT_FIELDS_PLAN;
  return {
    customerFields: answer.customerFields,
    lines: lines.map((line, index) => {
      const lineAnswer = answer.lines[index];
      return {
        lineId: line.lineId,
        productName: line.productName,
        productImage: line.productImage,
        quantity: line.quantity,
        itemFields: lineAnswer?.productId === line.productId ? lineAnswer.itemFields : [],
      };
    }),
  };
};

/** The checkout needs its "Détails de la location" step. */
export const hasCheckoutDetailsStep = (plan: CheckoutFieldsPlan): boolean =>
  plan.lines.some((line) => line.itemFields.length > 0);

type CustomFieldFormValues = Pick<CheckoutFormValues, "customerFields" | "itemDetails">;

export interface CheckoutFieldsSubmission {
  /** Every asked customer field; "" lets a signed-in customer clear a value. */
  customerFields: CustomerFieldValues;
  /** Each line asking item fields with all its units, empty ones included. */
  itemDetails: CheckoutItemDetailsInput;
}

/**
 * What the checkout sends of the custom fields: only what this cart asks, so
 * a value typed for a field that no longer applies (another buyer type, a
 * removed line) never leaves the browser.
 */
export const getCheckoutFieldsSubmission = (
  values: CustomFieldFormValues,
  plan: CheckoutFieldsPlan,
): CheckoutFieldsSubmission => ({
  customerFields: Object.fromEntries(
    plan.customerFields.map((field) => [field.id, values.customerFields[field.id] ?? ""]),
  ),
  itemDetails: plan.lines.flatMap((line, lineIndex) =>
    line.itemFields.length === 0
      ? []
      : [
          {
            lineIndex,
            units: Array.from({ length: line.quantity }, (_, unitIndex) => {
              const unit = values.itemDetails[toUnitKey(line.lineId, unitIndex)];
              const participantName = unit?.participantName?.trim();
              return {
                ...(participantName ? { participantName } : {}),
                values: Object.fromEntries(
                  line.itemFields.flatMap((field) => {
                    const value = unit?.values?.[field.id]?.trim();
                    return value ? [[field.id, value]] : [];
                  }),
                ),
              };
            }),
          },
        ],
  ),
});

/** Form path of a refused value (`["itemDetails", unitKey, "values", id]`), or null when its line left the cart. */
export const getCheckoutFieldIssuePath = (
  issue: CheckoutFieldIssue,
  plan: CheckoutFieldsPlan,
): string[] | null => {
  if (issue.target === "customer") return ["customerFields", issue.definitionId];
  const line = plan.lines[issue.lineIndex];
  return line
    ? ["itemDetails", toUnitKey(line.lineId, issue.unitIndex), "values", issue.definitionId]
    : null;
};

/**
 * The input a server refusal belongs to, as the form names it. Null when this
 * checkout does not show that field (the store changed its rules since the
 * page loaded): the alert above the step still names it.
 */
export const getCheckoutFieldIssueName = (
  issue: CheckoutFieldIssue,
  plan: CheckoutFieldsPlan,
): CheckoutCustomerFieldName | CheckoutItemFieldName | null => {
  const isShown = (fields: readonly CustomerFieldPublic[]) =>
    fields.some((field) => field.id === issue.definitionId);
  if (issue.target === "customer") {
    return isShown(plan.customerFields) ? toCustomerFieldName(issue.definitionId) : null;
  }
  const line = plan.lines[issue.lineIndex];
  return line && isShown(line.itemFields) && issue.unitIndex < line.quantity
    ? toItemFieldName(toUnitKey(line.lineId, issue.unitIndex), issue.definitionId)
    : null;
};

/**
 * Every value the shared rules refuse, with its form path: the browser runs
 * the very checks the server runs (`validateCheckoutFieldValues`).
 */
export const getCheckoutFieldIssues = (
  values: CustomFieldFormValues,
  plan: CheckoutFieldsPlan,
): { path: string[]; code: CustomerFieldIssueCode }[] => {
  if (plan.customerFields.length === 0 && !hasCheckoutDetailsStep(plan)) return [];
  const { issues } = validateCheckoutFieldValues({
    fields: { customerFields: plan.customerFields, lines: plan.lines },
    ...getCheckoutFieldsSubmission(values, plan),
  });
  return issues.flatMap((issue) => {
    const path = getCheckoutFieldIssuePath(issue, plan);
    return path ? [{ path, code: issue.code }] : [];
  });
};

/** The custom fields a step validates before letting the customer go on. */
export const getCheckoutFieldNamesForStep = (
  plan: CheckoutFieldsPlan,
  step: "contact" | "details",
): (CheckoutCustomerFieldName | CheckoutItemFieldName)[] =>
  step === "contact"
    ? plan.customerFields.map((field) => toCustomerFieldName(field.id))
    : plan.lines.flatMap((line) =>
        Array.from({ length: line.quantity }, (_, unitIndex) =>
          line.itemFields.map((field) =>
            toItemFieldName(toUnitKey(line.lineId, unitIndex), field.id),
          ),
        ).flat(),
      );

/**
 * A signed-in customer already gave every asked value and each one still
 * passes the rules: the contact step can fold them into one line.
 */
export const hasEveryCustomerFieldOnFile = (
  fields: readonly CustomerFieldPublic[],
  saved: CustomerFieldValues,
): boolean =>
  fields.length > 0 &&
  fields.every((field) => {
    const result = normalizeCustomerFieldValue(field, saved[field.id]);
    return !("code" in result) && result.value !== "";
  });
