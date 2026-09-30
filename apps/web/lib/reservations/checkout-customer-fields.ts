import { and, eq } from "drizzle-orm";

import { getCustomerFieldValues } from "@louez/api/services/customer-fields";
import { resolveCartCustomerFields } from "@louez/api/services/customer-fields-online";
import { customers, db } from "@louez/db";
import type {
  CustomerFieldDefinition,
  CustomerFieldValues,
  ReservationItemDetail,
} from "@louez/types";
import {
  validateCheckoutFieldValues,
  type CheckoutFieldIssue,
  type CheckoutItemDetailsInput,
  type CreateReservationCustomerInput,
} from "@louez/validations";

import { failReservation, type ReservationFailure } from "./reservation.types";

/** What a checkout writes of the custom fields it asked, once validated. */
export interface CheckoutCustomerFields {
  /** Customer-scope fields the checkout asked: the only ones it may write. */
  customerDefinitions: CustomerFieldDefinition[];
  /** Normalised values of the submitted ones; "" asks to clear (signed-in buyer only). */
  customerValues: CustomerFieldValues;
  /** Lines asking item fields, every unit listed (empty ones clear an earlier attempt). */
  itemDetails: {
    lineIndex: number;
    /** The asked item fields of the line: the keys this checkout owns on its units. */
    managedDefinitionIds: string[];
    units: ReservationItemDetail[];
  }[];
}

export const NO_CHECKOUT_CUSTOMER_FIELDS: CheckoutCustomerFields = {
  customerDefinitions: [],
  customerValues: {},
  itemDetails: [],
};

/** Values the buyer's e-mail already holds: a required field left out is then satisfied. */
const findValuesOnFile = async (storeId: string, email: string): Promise<CustomerFieldValues> => {
  const customer = await db.query.customers.findFirst({
    columns: { id: true },
    where: and(eq(customers.storeId, storeId), eq(customers.email, email)),
  });
  return customer ? getCustomerFieldValues(storeId, customer.id) : {};
};

/** The failure a checkout answers for its first issue, worded for the buyer. */
const toFailure = (
  issue: CheckoutFieldIssue,
  labelOf: (definitionId: string) => string,
  productNameOfLine: (lineIndex: number) => string,
  issues: CheckoutFieldIssue[],
): ReservationFailure => {
  const details = { code: "checkout_fields_invalid" as const, issues };
  if (issue.target === "customer") {
    return failReservation(
      issue.code === "required" ? "errors.customFieldRequired" : "errors.customFieldInvalid",
      { field: labelOf(issue.definitionId) },
      details,
    );
  }
  return failReservation(
    issue.code === "required" ? "errors.itemDetailRequired" : "errors.itemDetailInvalid",
    {
      field: labelOf(issue.definitionId),
      product: productNameOfLine(issue.lineIndex),
      unit: issue.unitIndex + 1,
    },
    details,
  );
};

/**
 * Re-resolves what the checkout asks for this cart from the store's live
 * definitions and checks the submitted values: a required field left empty
 * fails the checkout, anything that was not asked is dropped.
 */
export const prepareCheckoutCustomerFields = async (params: {
  storeId: string;
  customer: CreateReservationCustomerInput;
  items: readonly { productId: string; quantity: number }[];
  customerFields: CustomerFieldValues | undefined;
  itemDetails: CheckoutItemDetailsInput | undefined;
  productNameOf: (productId: string) => string;
}): Promise<{ ok: true; fields: CheckoutCustomerFields } | ReservationFailure> => {
  const resolved = await resolveCartCustomerFields(
    params.storeId,
    params.items,
    params.customer.customerType ?? "individual",
  );
  const asksItems = resolved.lines.some((line) => line.itemFields.length > 0);
  if (resolved.customerFields.length === 0 && !asksItems) {
    return { ok: true, fields: NO_CHECKOUT_CUSTOMER_FIELDS };
  }

  const validated = validateCheckoutFieldValues({
    fields: {
      customerFields: resolved.customerFields,
      lines: resolved.lines.map((line, index) => ({
        quantity: params.items[index]?.quantity ?? 0,
        itemFields: line.itemFields,
      })),
    },
    customerFields: params.customerFields,
    itemDetails: params.itemDetails,
    existingCustomerValues:
      resolved.customerFields.length > 0
        ? await findValuesOnFile(params.storeId, params.customer.email)
        : null,
  });

  const [firstIssue] = validated.issues;
  if (firstIssue) {
    const labels = new Map(
      [...resolved.customerFields, ...resolved.lines.flatMap((line) => line.itemFields)].map(
        (definition) => [definition.id, definition.label],
      ),
    );
    return toFailure(
      firstIssue,
      (definitionId) => labels.get(definitionId) ?? "",
      (lineIndex) => params.productNameOf(params.items[lineIndex]?.productId ?? ""),
      validated.issues,
    );
  }

  return {
    ok: true,
    fields: {
      customerDefinitions: resolved.customerFields,
      customerValues: validated.customerValues,
      itemDetails: validated.itemDetails.map((line) => ({
        ...line,
        managedDefinitionIds: (resolved.lines[line.lineIndex]?.itemFields ?? []).map(
          (definition) => definition.id,
        ),
      })),
    },
  };
};
