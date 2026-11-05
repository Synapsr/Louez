import { and, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { getCustomerFieldValues } from "@louez/api/services/customer-fields";
import { resolveCartCustomerFields } from "@louez/api/services/customer-fields-online";
import { NO_CUSTOMER_PROFILE_VALUES } from "@louez/api/services/customer-profile-fields";
import { customers, db } from "@louez/db";
import type {
  CustomerFieldDefinition,
  CustomerFieldValues,
  ReservationItemDetail,
  ResolvedCustomerProfileSettings,
} from "@louez/types";
import {
  toCheckoutProfileIssue,
  validateCheckoutFieldValues,
  validateCustomerProfileValues,
  type CheckoutFieldIssue,
  type CheckoutItemDetailsInput,
  type CreateReservationCustomerInput,
  type CustomerProfileValues,
  type CustomerProfileValuesInput,
  type CustomerProfileValuesPatch,
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
  /**
   * Native columns of the asked profile fields, normalised; null asks to
   * clear (signed-in buyer only). Fields not asked are absent.
   */
  profileValues: CustomerProfileValuesPatch;
}

export const NO_CHECKOUT_CUSTOMER_FIELDS: CheckoutCustomerFields = {
  customerDefinitions: [],
  customerValues: {},
  itemDetails: [],
  profileValues: {},
};

interface ValuesOnFile {
  customFields: CustomerFieldValues;
  profile: CustomerProfileValues;
}

/** What the buyer's e-mail already holds: a required field left out is then satisfied. */
const findValuesOnFile = async (storeId: string, email: string): Promise<ValuesOnFile> => {
  const customer = await db.query.customers.findFirst({
    columns: {
      id: true,
      birthDate: true,
      acquisitionSource: true,
      acquisitionSourceDetail: true,
      socialLinks: true,
    },
    where: and(eq(customers.storeId, storeId), eq(customers.email, email)),
  });
  if (!customer) return { customFields: {}, profile: NO_CUSTOMER_PROFILE_VALUES };
  const { id, ...profile } = customer;
  return { customFields: await getCustomerFieldValues(storeId, id), profile };
};

/**
 * A native field's name as the buyer reads it, in the request's language
 * (the one the checkout is shown in): it goes into the error message.
 */
const getProfileFieldLabel = async (issue: Extract<CheckoutFieldIssue, { target: "profile" }>) => {
  const t = await getTranslations("storefront.customerFields.profile");
  return t(issue.field);
};

/** The failure a checkout answers for its first issue, worded for the buyer. */
const toFailure = async (
  issue: CheckoutFieldIssue,
  labelOf: (definitionId: string) => string,
  productNameOfLine: (lineIndex: number) => string,
  issues: CheckoutFieldIssue[],
): Promise<ReservationFailure> => {
  const details = { code: "checkout_fields_invalid" as const, issues };
  if (issue.target === "profile") {
    return failReservation(
      issue.code === "required" ? "errors.profileFieldRequired" : "errors.profileFieldInvalid",
      { field: await getProfileFieldLabel(issue) },
      details,
    );
  }
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
  profileFields: CustomerProfileValuesInput | undefined;
  /** The store's native field settings, resolved. */
  profileSettings: ResolvedCustomerProfileSettings;
  productNameOf: (productId: string) => string;
}): Promise<{ ok: true; fields: CheckoutCustomerFields } | ReservationFailure> => {
  const resolved = await resolveCartCustomerFields(
    params.storeId,
    params.items,
    params.customer.customerType ?? "individual",
    params.profileSettings,
  );
  const asksItems = resolved.lines.some((line) => line.itemFields.length > 0);
  const asksCustomer = resolved.customerFields.length > 0 || resolved.profileFields.length > 0;
  if (!asksCustomer && !asksItems) {
    return { ok: true, fields: NO_CHECKOUT_CUSTOMER_FIELDS };
  }

  const onFile = asksCustomer
    ? await findValuesOnFile(params.storeId, params.customer.email)
    : null;
  const profile = validateCustomerProfileValues({
    fields: resolved.profileFields,
    values: params.profileFields,
    onFile: onFile?.profile,
  });
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
    existingCustomerValues: onFile?.customFields ?? null,
  });

  // The profile group comes first on the contact step: so do its issues.
  const issues = [...profile.issues.map(toCheckoutProfileIssue), ...validated.issues];
  const [firstIssue] = issues;
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
      issues,
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
      profileValues: profile.values,
    },
  };
};
