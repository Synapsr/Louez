import { z } from 'zod';

const idSchema = z.string().length(21);
const dateInputSchema = z.coerce.date();
const optionalDateInputSchema = z
  .preprocess(
    (value) => (value === '' ? null : value),
    z.coerce.date().nullable(),
  )
  .optional();
const moneyInputSchema = z
  .preprocess(
    (value) => (value === '' ? null : value),
    z
      .string()
      .trim()
      .regex(/^\d+([.,]\d{1,2})?$/, 'validation.positive')
      .nullable(),
  )
  .optional();

export const unitDowntimeReasonSchema = z.enum([
  'maintenance',
  'repair',
  'other',
]);

export const unitRetirementReasonSchema = z.enum([
  'sold',
  'lost',
  'broken',
  'other',
]);

export const inventoryStateSchema = z.enum([
  'available',
  'reserved',
  'rented_out',
  'overdue',
  'in_downtime',
  'retired',
]);

export const declareDowntimeSchema = z
  .object({
    unitId: idSchema,
    reason: unitDowntimeReasonSchema,
    startsAt: dateInputSchema,
    endsAt: optionalDateInputSchema,
    note: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (data) =>
      data.endsAt === undefined ||
      data.endsAt === null ||
      data.startsAt < data.endsAt,
    {
      path: ['endsAt'],
      message: 'validation.invalidDateRange',
    },
  );

export const updateDowntimeSchema = z.object({
  downtimeId: idSchema,
  reason: unitDowntimeReasonSchema.optional(),
  startsAt: dateInputSchema.optional(),
  endsAt: optionalDateInputSchema,
  note: z.string().max(2000).optional().nullable(),
});

export const closeDowntimeSchema = z.object({
  downtimeId: idSchema,
  endsAt: dateInputSchema.optional(),
});

export const deleteDowntimeSchema = z.object({
  downtimeId: idSchema,
});

export const retireUnitSchema = z.object({
  unitId: idSchema,
  reason: unitRetirementReasonSchema,
  note: z.string().max(2000).optional().nullable(),
});

export const reinstateUnitSchema = z.object({
  unitId: idSchema,
});

export const updateUnitDetailsSchema = z.object({
  unitId: idSchema,
  notes: z.string().max(1000).optional().nullable(),
  purchasePrice: moneyInputSchema,
  purchasedAt: optionalDateInputSchema,
});

export const reassignReservationItemUnitSchema = z.object({
  reservationItemId: idSchema,
  fromUnitId: idSchema,
  toUnitId: idSchema,
  overrideTurnoverBuffer: z.boolean().optional(),
});

export const getInventorySchema = z.object({
  productId: idSchema.optional(),
  lifecycle: z.enum(['active', 'retired']).optional(),
  state: inventoryStateSchema.optional(),
  search: z.string().max(100).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

export const getUnitTimelineSchema = z.object({
  unitId: idSchema,
});

export const getUnitDowntimesSchema = z.object({
  unitId: idSchema,
});

export type DeclareDowntimeInput = z.infer<typeof declareDowntimeSchema>;
export type UpdateDowntimeInput = z.infer<typeof updateDowntimeSchema>;
export type CloseDowntimeInput = z.infer<typeof closeDowntimeSchema>;
export type DeleteDowntimeInput = z.infer<typeof deleteDowntimeSchema>;
export type RetireUnitInput = z.infer<typeof retireUnitSchema>;
export type ReinstateUnitInput = z.infer<typeof reinstateUnitSchema>;
export type UpdateUnitDetailsInput = z.infer<typeof updateUnitDetailsSchema>;
export type ReassignReservationItemUnitInput = z.infer<
  typeof reassignReservationItemUnitSchema
>;
export type GetInventoryInput = z.infer<typeof getInventorySchema>;
export type GetUnitTimelineInput = z.infer<typeof getUnitTimelineSchema>;
export type GetUnitDowntimesInput = z.infer<typeof getUnitDowntimesSchema>;
