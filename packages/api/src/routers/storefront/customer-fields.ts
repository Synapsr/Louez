import { customers, db, reservations } from "@louez/db";
import type { CustomerFieldValues } from "@louez/types";
import {
  accountProfileFieldSchema,
  canCustomerEditReservationDetails,
  checkoutProfileFieldSchema,
  customerFieldAccountSchema,
  customerFieldPublicSchema,
  customerFieldSubmittedValuesSchema,
  customerFieldValuesSchema,
  customerProfileValuesInputSchema,
  customerProfileValuesSchema,
  listAskedProfileFields,
  normalizeCustomerFieldValue,
  pickCustomerProfileValues,
  reservationItemDetailSchema,
  reservationItemDetailsUpdateInputSchema,
  resolveCustomerProfileSettings,
  toAccountCustomerField,
  toPublicCustomerField,
  validateCustomerProfileValues,
  validateItemDetailUnits,
  type CustomerFieldIssue,
  type ReservationItemDetailIssue,
} from "@louez/validations";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { CustomerData, StorefrontContext } from "../../context";
import { storefrontAuthProcedure, storefrontProcedure } from "../../procedures";
import {
  getCustomerFieldValues,
  listCustomerFieldDefinitions,
  saveCustomerFieldValues,
} from "../../services/customer-fields";
import {
  listReservationItemDetails,
  resolveCartCustomerFields,
  saveReservationItemDetails,
  type ReservationItemDetailsWrite,
} from "../../services/customer-fields-online";
import {
  NO_CUSTOMER_PROFILE_VALUES,
  getCustomerProfileValues,
  saveCustomerProfileValues,
} from "../../services/customer-profile-fields";

const customerTypeSchema = z.enum(["individual", "business"]);

const requireCustomer = (context: StorefrontContext): CustomerData => {
  if (!context.customer) {
    throw new ORPCError("UNAUTHORIZED", { message: "errors.customerNotAuthenticated" });
  }
  return context.customer;
};

/**
 * What the checkout asks for this cart: native profile fields and customer
 * fields for the contact step, item fields per line for "Détails de la
 * location". Public subset only: team-only fields and targets never leave the
 * server.
 */
const forCart = storefrontProcedure
  .input(
    z.object({
      lines: z
        .array(
          z.object({
            productId: z.string().trim().min(1).max(64),
            quantity: z.number().int().min(1).max(999),
          }),
        )
        .min(1)
        .max(50),
      customerType: customerTypeSchema.default("individual"),
    }),
  )
  .output(
    z.object({
      /** Birth date, source, links: asked for this cart, in the record's order. */
      profileFields: z.array(checkoutProfileFieldSchema),
      customerFields: z.array(customerFieldPublicSchema),
      /** Same order as the input lines. */
      lines: z.array(
        z.object({
          productId: z.string(),
          quantity: z.number(),
          itemFields: z.array(customerFieldPublicSchema),
        }),
      ),
    }),
  )
  .handler(async ({ context, input }) => {
    const resolved = await resolveCartCustomerFields(
      context.store.id,
      input.lines,
      input.customerType,
      resolveCustomerProfileSettings(context.store.settings?.customerProfile),
    );
    return {
      profileFields: resolved.profileFields,
      customerFields: resolved.customerFields.map(toPublicCustomerField),
      lines: input.lines.map((line, index) => ({
        productId: line.productId,
        quantity: line.quantity,
        itemFields: (resolved.lines[index]?.itemFields ?? []).map(toPublicCustomerField),
      })),
    };
  });

const myValuesOutputSchema = z.object({
  /** The profile's type; a checkout may still be done as the other type. */
  customerType: customerTypeSchema,
  /** Customer-scope fields the checkout may ask, whatever the cart; `customerEditable` marks the profile ones. */
  fields: z.array(customerFieldAccountSchema),
  values: customerFieldValuesSchema,
  /** Native fields the checkout may ask, whatever the cart, in the record's order. */
  profileFields: z.array(accountProfileFieldSchema),
  /** The customer's native values; null for a field the store does not ask. */
  profile: customerProfileValuesSchema,
});

/** Asked native fields and the signed-in customer's values for them, the others left out. */
const loadMyProfile = async (storeId: string, customerId: string, settings: unknown) => {
  const profileFields = listAskedProfileFields(resolveCustomerProfileSettings(settings));
  const profile =
    profileFields.length > 0
      ? pickCustomerProfileValues(
          await getCustomerProfileValues(storeId, customerId),
          profileFields,
        )
      : NO_CUSTOMER_PROFILE_VALUES;
  return { profileFields, profile };
};

/** Asked customer-scope fields and the signed-in customer's values for them (checkout prefill, account profile). */
const loadMyValues = async (storeId: string, customerId: string) => {
  const customer = await db.query.customers.findFirst({
    columns: { customerType: true },
    where: and(eq(customers.id, customerId), eq(customers.storeId, storeId)),
  });
  if (!customer) {
    throw new ORPCError("UNAUTHORIZED", { message: "errors.customerNotAuthenticated" });
  }
  const fields = (
    await listCustomerFieldDefinitions(storeId, { activeOnly: true, scope: "customer" })
  ).filter((definition) => definition.collectMode !== "never");
  const stored = await getCustomerFieldValues(storeId, customerId);
  const values: CustomerFieldValues = Object.fromEntries(
    fields.flatMap((field) => {
      const value = stored[field.id];
      return value ? [[field.id, value]] : [];
    }),
  );
  return { customerType: customer.customerType, fields, values };
};

/** Everything `myValues` answers, for the signed-in customer. */
const loadMyAccountValues = async (context: StorefrontContext, customerId: string) => {
  const storeId = context.store.id;
  const [result, native] = await Promise.all([
    loadMyValues(storeId, customerId),
    loadMyProfile(storeId, customerId, context.store.settings?.customerProfile),
  ]);
  return { ...result, fields: result.fields.map(toAccountCustomerField), ...native };
};

const myValues = storefrontAuthProcedure
  .output(myValuesOutputSchema)
  .handler(async ({ context }) => {
    const customer = requireCustomer(context);
    return loadMyAccountValues(context, customer.id);
  });

/**
 * The customer updates their own values from their account. Only fields
 * marked editable by the customer are written, native ones (`profile`)
 * included; keys left out are untouched, an empty value clears (except on a
 * field the checkout requires).
 */
const updateMyValues = storefrontAuthProcedure
  .input(
    z.object({
      values: customerFieldSubmittedValuesSchema.default({}),
      profile: customerProfileValuesInputSchema.optional(),
    }),
  )
  .output(myValuesOutputSchema)
  .handler(async ({ context, input }) => {
    const customer = requireCustomer(context);
    const storeId = context.store.id;
    const { fields } = await loadMyValues(storeId, customer.id);
    const editable = fields.filter((field) => field.customerEditable);
    const editableProfile = listAskedProfileFields(
      resolveCustomerProfileSettings(context.store.settings?.customerProfile),
    ).filter((field) => field.customerEditable);

    const values: CustomerFieldValues = {};
    const issues: CustomerFieldIssue[] = [];
    for (const field of editable) {
      const submitted = input.values[field.id];
      if (submitted === undefined) continue;
      const result = normalizeCustomerFieldValue(field, submitted);
      if ("code" in result) {
        issues.push({ definitionId: field.id, code: result.code });
      } else if (result.value === "" && field.collectMode === "required") {
        issues.push({ definitionId: field.id, code: "required" });
      } else {
        values[field.id] = result.value;
      }
    }
    const profile = validateCustomerProfileValues({
      fields: editableProfile,
      values: input.profile,
      partial: true,
    });
    if (issues.length > 0 || profile.issues.length > 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: "errors.customFieldsInvalid",
        data: { issues, profileIssues: profile.issues },
      });
    }

    await db.transaction(async (tx) => {
      await saveCustomerFieldValues(tx, {
        storeId,
        customerId: customer.id,
        values,
        definitions: editable,
        mode: "overwrite",
      });
      await saveCustomerProfileValues(tx, {
        storeId,
        customerId: customer.id,
        values: profile.values,
        mode: "overwrite",
      });
    });
    return loadMyAccountValues(context, customer.id);
  });

const reservationDetailsOutputSchema = z.object({
  /** The reservation has not started and is not closed: editable fields may change. */
  editable: z.boolean(),
  items: z.array(
    z.object({
      reservationItemId: z.string(),
      productId: z.string(),
      productName: z.string(),
      productImage: z.string().nullable(),
      quantity: z.number(),
      /** Fields the checkout asks for this line (never team-only ones). */
      fields: z.array(customerFieldAccountSchema),
      /** Exactly `quantity` units, values restricted to `fields`. */
      units: z.array(reservationItemDetailSchema),
    }),
  ),
});

const findOwnReservation = async (storeId: string, customerId: string, reservationId: string) => {
  const reservation = await db.query.reservations.findFirst({
    columns: { id: true, status: true, startDate: true },
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, storeId),
      eq(reservations.customerId, customerId),
    ),
  });
  if (!reservation) {
    throw new ORPCError("NOT_FOUND", { message: "errors.reservationNotFound" });
  }
  return reservation;
};

const loadReservationDetails = async (
  storeId: string,
  reservation: { id: string; status: string; startDate: Date },
) => {
  const views = await listReservationItemDetails({
    storeId,
    reservationId: reservation.id,
    audience: "customer",
  });
  return {
    editable: canCustomerEditReservationDetails(reservation, new Date()),
    items: views.map((view) => ({ ...view, fields: view.fields.map(toAccountCustomerField) })),
  };
};

/** "Détails de la location" of the customer's own reservation. */
const reservationDetails = storefrontAuthProcedure
  .input(z.object({ reservationId: z.string().min(1).max(21) }))
  .output(reservationDetailsOutputSchema)
  .handler(async ({ context, input }) => {
    const customer = requireCustomer(context);
    const reservation = await findOwnReservation(
      context.store.id,
      customer.id,
      input.reservationId,
    );
    return loadReservationDetails(context.store.id, reservation);
  });

/**
 * The customer changes what they recorded, until the rental starts. Only
 * fields editable by the customer are written (other recorded values stay),
 * and a field the checkout requires cannot be emptied.
 */
const updateReservationDetails = storefrontAuthProcedure
  .input(reservationItemDetailsUpdateInputSchema)
  .output(reservationDetailsOutputSchema)
  .handler(async ({ context, input }) => {
    const customer = requireCustomer(context);
    const storeId = context.store.id;
    const reservation = await findOwnReservation(storeId, customer.id, input.reservationId);
    if (!canCustomerEditReservationDetails(reservation, new Date())) {
      throw new ORPCError("FORBIDDEN", { message: "errors.reservationDetailsLocked" });
    }

    const views = await listReservationItemDetails({
      storeId,
      reservationId: reservation.id,
      audience: "customer",
    });
    const viewById = new Map(views.map((view) => [view.reservationItemId, view]));

    const issues: ReservationItemDetailIssue[] = [];
    const writes: ReservationItemDetailsWrite[] = [];
    for (const item of input.items) {
      const view = viewById.get(item.reservationItemId);
      const editableFields = view?.fields.filter((field) => field.customerEditable) ?? [];
      if (!view || editableFields.length === 0) {
        throw new ORPCError("FORBIDDEN", { message: "errors.reservationDetailsLocked" });
      }

      const result = validateItemDetailUnits({
        fields: editableFields,
        quantity: view.quantity,
        units: item.units,
        enforceRequired: true,
      });
      issues.push(
        ...result.issues.map((issue) => ({ reservationItemId: item.reservationItemId, ...issue })),
      );
      writes.push({
        reservationItemId: item.reservationItemId,
        managedDefinitionIds: editableFields.map((field) => field.id),
        managesParticipantName: true,
        units: result.units,
      });
    }
    if (issues.length > 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: "errors.customFieldsInvalid",
        data: { issues },
      });
    }

    await db.transaction((tx) =>
      saveReservationItemDetails(tx, { storeId, reservationId: reservation.id, items: writes }),
    );
    return loadReservationDetails(storeId, reservation);
  });

export const storefrontCustomerFieldsRouter = {
  forCart,
  myValues,
  updateMyValues,
  reservationDetails,
  updateReservationDetails,
};
