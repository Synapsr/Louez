import { db, reservations } from "@louez/db";
import {
  customerFieldDefinitionSchema,
  reservationItemDetailSchema,
  reservationItemDetailsUpdateInputSchema,
  validateItemDetailUnits,
  type ReservationItemDetailIssue,
} from "@louez/validations";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { dashboardProcedure, requirePermission } from "../../procedures";
import {
  listReservationItemDetails,
  saveReservationItemDetails,
  type ReservationItemDetailsWrite,
} from "../../services/customer-fields-online";

const itemDetailsOutputSchema = z.object({
  items: z.array(
    z.object({
      reservationItemId: z.string(),
      productId: z.string(),
      productName: z.string(),
      productImage: z.string().nullable(),
      quantity: z.number(),
      /** Item-scope fields of the line, whatever their collect mode. */
      fields: z.array(customerFieldDefinitionSchema),
      /** Exactly `quantity` units, in order. */
      units: z.array(reservationItemDetailSchema),
    }),
  ),
});

const assertStoreReservation = async (storeId: string, reservationId: string) => {
  const reservation = await db.query.reservations.findFirst({
    columns: { id: true },
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)),
  });
  if (!reservation) {
    throw new ORPCError("NOT_FOUND", { message: "errors.reservationNotFound" });
  }
};

/** "Détails de la location" of a reservation: catalog lines with item-scope fields to show. */
const itemDetails = dashboardProcedure
  .input(z.object({ reservationId: z.string().min(1).max(21) }))
  .output(itemDetailsOutputSchema)
  .handler(async ({ context, input }) => {
    const storeId = context.store.id;
    await assertStoreReservation(storeId, input.reservationId);
    return {
      items: await listReservationItemDetails({
        storeId,
        reservationId: input.reservationId,
        audience: "team",
      }),
    };
  });

/**
 * The team records or corrects units, like any reservation edit. Each unit
 * listed is replaced for the line's fields; required-by-the-checkout fields
 * may stay empty (the team fills what it knows).
 */
const updateItemDetails = requirePermission("write")
  .input(reservationItemDetailsUpdateInputSchema)
  .output(itemDetailsOutputSchema)
  .handler(async ({ context, input }) => {
    const storeId = context.store.id;
    await assertStoreReservation(storeId, input.reservationId);

    const views = await listReservationItemDetails({
      storeId,
      reservationId: input.reservationId,
      audience: "team",
    });
    const viewById = new Map(views.map((view) => [view.reservationItemId, view]));

    const issues: ReservationItemDetailIssue[] = [];
    const writes: ReservationItemDetailsWrite[] = [];
    for (const item of input.items) {
      const view = viewById.get(item.reservationItemId);
      if (!view) throw new ORPCError("NOT_FOUND", { message: "errors.invalidData" });

      const result = validateItemDetailUnits({
        fields: view.fields,
        quantity: view.quantity,
        units: item.units,
        enforceRequired: false,
      });
      issues.push(
        ...result.issues.map((issue) => ({ reservationItemId: item.reservationItemId, ...issue })),
      );
      writes.push({
        reservationItemId: item.reservationItemId,
        managedDefinitionIds: view.fields.map((field) => field.id),
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
      saveReservationItemDetails(tx, {
        storeId,
        reservationId: input.reservationId,
        items: writes,
      }),
    );
    return {
      items: await listReservationItemDetails({
        storeId,
        reservationId: input.reservationId,
        audience: "team",
      }),
    };
  });

export const dashboardReservationDetailsRouter = {
  itemDetails,
  updateItemDetails,
};
