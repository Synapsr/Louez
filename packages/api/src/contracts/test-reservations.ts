import { z } from "zod";

import { reservationStatusSchema } from "./reservations";

/**
 * The store's test reservation, as the dashboard's onboarding shows it
 * (packages/db test-reservations.ts). A dashboard session only: no key, OAuth
 * or MCP connection and not the in-app assistant (`meta.actors`).
 */

const idSchema = z.string().min(1).max(64);

export const getTestReservationInput = z.object({});

export const testReservationSchema = z.object({
  id: z.string(),
  status: reservationStatusSchema,
  createdAt: z.date(),
  /** When the daily cleanup deletes it: its creation plus `TEST_RESERVATION_LIFETIME_DAYS`. */
  expiresAt: z.date(),
});

export const getTestReservationOutput = z.object({
  /** The store's test reservation, null when it has none (or it expired). */
  reservation: testReservationSchema.nullable(),
  /** The store asks for an inspection at pickup and return (Settings > Inspections). */
  inspectionsEnabled: z.boolean(),
  /** The test reservation's inspections, by type; false without a reservation. */
  hasDepartureInspection: z.boolean(),
  hasReturnInspection: z.boolean(),
  /** The storefront's home, to share once the test is done. */
  storefrontUrl: z.string(),
  /** The store has a reeent (marketplace) channel: the finish screen links to its settings. */
  hasMarketplaceChannel: z.boolean(),
});
export type GetTestReservationOutput = z.infer<typeof getTestReservationOutput>;

export const startTestReservationInput = z.object({});

/**
 * Either the storefront's address that opens test mode for two hours, or the
 * store's test reservation still running (one per store).
 */
export const startTestReservationOutput = z.union([
  z.object({ url: z.string() }),
  z.object({ existing: z.string() }),
]);

export const deleteTestReservationInput = z.object({
  /** The test reservation to delete; the store's own when left out. */
  reservationId: idSchema.optional(),
});

export const deleteTestReservationOutput = z.object({
  /** False when there was nothing to delete. */
  deleted: z.boolean(),
});
