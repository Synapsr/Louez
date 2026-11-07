import { z } from "zod";

import { apiError } from "../platform/errors";

/**
 * The contract of a product's units: their history, their downtimes and
 * their retirement. No database here.
 */

export const PRODUCT_UNIT_EVENT_TYPES = [
  "created",
  "deleted",
  "downtime_declared",
  "downtime_updated",
  "downtime_closed",
  "downtime_deleted",
  "retired",
  "reinstated",
  "assigned",
  "unassigned",
  "updated",
] as const;
export const PRODUCT_UNIT_DOWNTIME_REASONS = ["maintenance", "repair", "other"] as const;
export const PRODUCT_UNIT_DOWNTIME_STATUSES = ["current", "upcoming", "past"] as const;

const idSchema = z.string().min(1).max(64);
const noteSchema = z.string().max(2000).nullable().optional();
const downtimeReasonSchema = z
  .enum(PRODUCT_UNIT_DOWNTIME_REASONS)
  .describe("maintenance, repair or other.");
const retirementReasonSchema = z.enum(["sold", "lost", "broken", "other"]);
const excludeReservationItemIdsSchema = z
  .array(idSchema)
  .max(100)
  .optional()
  .describe(
    "Reservation lines to leave out of the overlap check, such as the lines of the reservation the unit just came back from.",
  );

// --- History -----------------------------------------------------------------

export const unitHistoryInput = z.object({
  unitId: idSchema.describe("The unit's id, from products_get (units[].id)."),
});

const unitTimelineEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("event"),
    id: z.string(),
    type: z.enum(PRODUCT_UNIT_EVENT_TYPES),
    actorUserId: z.string().nullable(),
    actorName: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("assignment"),
    id: z.string(),
    type: z.literal("assigned"),
    reservationId: z.string(),
    reservationNumber: z.string(),
    reservationItemId: z.string(),
    identifierSnapshot: z.string(),
    customerName: z.string().nullable(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    createdAt: z.string().datetime(),
  }),
]);

export const unitHistoryOutput = z.object({
  /** Events and reservation assignments, newest first. */
  timeline: z.array(unitTimelineEntrySchema),
  /** Current first, then upcoming, then past. */
  downtimes: z.array(
    z.object({
      id: z.string(),
      reason: z.enum(PRODUCT_UNIT_DOWNTIME_REASONS),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime().nullable(),
      note: z.string().nullable(),
      status: z.enum(PRODUCT_UNIT_DOWNTIME_STATUSES),
    }),
  ),
});

// --- Conflicts -----------------------------------------------------------------

/** A reservation that holds the unit while it is out, with the units that could serve it instead. */
export const unitConflictSchema = z.object({
  reservationId: z.string(),
  reservationNumber: z.string(),
  customerName: z.string().nullable(),
  startDate: z.date(),
  /** End of the booking, return buffer included. */
  endDate: z.date(),
  reservationItemId: z.string(),
  replacementCandidates: z.array(
    z.object({ id: z.string(), identifier: z.string(), notes: z.string().nullable() }),
  ),
});
export type UnitConflictOutput = z.infer<typeof unitConflictSchema>;

// --- Downtimes -----------------------------------------------------------------

export const declareDowntimeInput = z.object({
  unitId: idSchema,
  reason: downtimeReasonSchema,
  startsAt: z.coerce.date().describe("When the unit goes out, ISO 8601 with a time zone."),
  endsAt: z.coerce
    .date()
    .nullable()
    .optional()
    .describe("When it is back, after startsAt. Null or left out: until closed."),
  note: noteSchema,
  excludeReservationItemIds: excludeReservationItemIdsSchema,
});
export const declareDowntimeOutput = z.object({
  downtimeId: z.string(),
  /** Reservations that hold the unit during the downtime; move them to another unit. */
  conflicts: z.array(unitConflictSchema),
});

/** Partial: a field left out is unchanged; endsAt null makes it open-ended, note null clears it. */
export const updateDowntimeInput = z.object({
  downtimeId: idSchema,
  reason: downtimeReasonSchema.optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  note: noteSchema,
  excludeReservationItemIds: excludeReservationItemIdsSchema,
});
export const updateDowntimeOutput = declareDowntimeOutput;

export const closeDowntimeInput = z.object({
  downtimeId: idSchema,
  endsAt: z.coerce
    .date()
    .optional()
    .describe("When the unit is back, after the downtime's start. Default: now."),
});
export const closeDowntimeOutput = z.object({
  downtimeId: z.string(),
  endsAt: z.date(),
});

export const downtimeIdInput = z.object({ downtimeId: idSchema });
export const deleteDowntimeOutput = z.object({ downtimeId: z.string() });

// --- Retirement and details ------------------------------------------------------

export const retireUnitInput = z.object({
  unitId: idSchema,
  reason: retirementReasonSchema.describe("sold, lost, broken or other."),
  note: noteSchema,
});
export const retireUnitOutput = z.object({
  unitId: z.string(),
  /** Current and future reservations that hold the unit; move them to another unit. */
  conflicts: z.array(unitConflictSchema),
});

export const reinstateUnitInput = z.object({ unitId: idSchema });
export const reinstateUnitOutput = z.object({ unitId: z.string() });

const moneySchema = z
  .string()
  .trim()
  .regex(/^\d+([.,]\d{1,2})?$/, "An amount is a decimal string with at most 2 decimals.");

/** Partial: a field left out is unchanged, null clears it. */
export const updateUnitDetailsInput = z.object({
  unitId: idSchema,
  notes: z.string().max(1000).nullable().optional(),
  purchasePrice: moneySchema.nullable().optional().describe('What the unit cost, e.g. "450.00".'),
  purchasedAt: z.coerce.date().nullable().optional(),
});
export const updateUnitDetailsOutput = z.object({
  unitId: z.string(),
  notes: z.string().nullable(),
  purchasePrice: z.string().nullable(),
  purchasedAt: z.date().nullable(),
});

// --- Errors ------------------------------------------------------------------------

export const productUnitErrors = {
  unitNotFound: (id: string) =>
    apiError("NOT_FOUND", "UNIT_NOT_FOUND", {
      message: `This store has no unit ${id}. A product's units are in products_get (units[].id).`,
      i18nKey: "errors.notFound",
      details: { id },
    }),
  downtimeNotFound: (id: string) =>
    apiError("NOT_FOUND", "DOWNTIME_NOT_FOUND", {
      message: `This store has no downtime ${id}. A unit's downtimes are in products_get_unit_history.`,
      i18nKey: "errors.notFound",
      details: { id },
    }),
  downtimeDates: () =>
    apiError("BAD_REQUEST", "DOWNTIME_DATES_INVALID", {
      message: "A downtime must end after it starts.",
      i18nKey: "errors.invalidData",
    }),
  alreadyRetired: (id: string) =>
    apiError("CONFLICT", "UNIT_ALREADY_RETIRED", {
      message: "This unit is already retired. products_reinstate_unit puts it back in service.",
      i18nKey: "errors.unitAlreadyRetired",
      details: { id },
    }),
  notRetired: (id: string) =>
    apiError("CONFLICT", "UNIT_NOT_RETIRED", {
      message: "This unit is in service: only a retired unit can be reinstated.",
      i18nKey: "errors.unitNotRetired",
      details: { id },
    }),
} as const;
