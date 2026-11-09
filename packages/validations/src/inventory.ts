import { z } from 'zod';

const idSchema = z.string().length(21);

export const inventoryStateSchema = z.enum([
  'available',
  'reserved',
  'rented_out',
  'overdue',
  'in_downtime',
  'retired',
]);

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

export type ReassignReservationItemUnitInput = z.infer<
  typeof reassignReservationItemUnitSchema
>;
export type GetInventoryInput = z.infer<typeof getInventorySchema>;
export type GetUnitTimelineInput = z.infer<typeof getUnitTimelineSchema>;
export type GetUnitDowntimesInput = z.infer<typeof getUnitDowntimesSchema>;
