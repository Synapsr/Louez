import {
  aiAdvisorConversations,
  apiEffects,
  customerCommunicationPreferences,
  customerFieldValues,
  customerSessions,
  customers,
  db,
  discordLogs,
  documents,
  emailLogs,
  findStoreTestReservation,
  inboxAcknowledgements,
  inspectionFieldValues,
  inspectionItems,
  inspectionPhotos,
  inspections,
  isReservationChangeBusyError,
  lockCustomerRow,
  marketplaceBookingAttempts,
  paymentDisputes,
  paymentRefundOperations,
  paymentRequests,
  payments,
  productUnitEvents,
  reminderLogs,
  reservationActivity,
  reservationCalendarEvents,
  reservationContractSignatures,
  reservationItemDetails,
  reservationItemUnits,
  reservationItems,
  reservations,
  reviewRequestLogs,
  runReservationChange,
  smsLogs,
  storeMarketplaceChannels,
  storefrontEvents,
  TEST_RESERVATION_LIFETIME_DAYS,
  type Transaction,
  verificationCodes,
} from "@louez/db";
import { DEFAULT_INSPECTION_SETTINGS } from "@louez/types";
import { and, asc, eq, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";

import { reservationErrors } from "../contracts/reservations";
import type { GetTestReservationOutput } from "../contracts/test-reservations";
import {
  analyticsEventIdentity,
  enqueueEffects,
  type ApiEffect,
  type ApiEffectPayloads,
} from "../platform/effects";
import type { UrlsPort } from "../platform/ports";
import type { ActorStore } from "../platform/procedures";
import { createTestModePass } from "./test-reservation-token";

/**
 * The store's test reservation, from the dashboard (packages/db
 * test-reservations.ts): what the onboarding guide reads, the pass that
 * opens the storefront in test mode, and the purge that deletes a test
 * reservation with everything that hangs from it, by hand or after
 * `TEST_RESERVATION_LIFETIME_DAYS` (the daily cron, and `start`).
 */

type TestAnalytics = ApiEffectPayloads["testReservation.analytics"];
type TestAnalyticsEffect = Extract<ApiEffect, { type: "testReservation.analytics" }>;

const DAY_MS = 86_400_000;

/** When the daily cleanup deletes a test reservation. */
export const testReservationExpiresAt = (createdAt: Date): Date =>
  new Date(createdAt.getTime() + TEST_RESERVATION_LIFETIME_DAYS * DAY_MS);

const isExpired = (createdAt: Date, now: Date) => testReservationExpiresAt(createdAt) <= now;

/** A test reservation's analytics event, as an outbox row. */
export const testReservationAnalytics = (
  event: TestAnalytics["event"],
  input: { storeId: string; distinctId: string; properties?: Record<string, string> },
): TestAnalyticsEffect => ({
  type: "testReservation.analytics",
  payload: {
    ...analyticsEventIdentity(new Date()),
    event,
    distinctId: input.distinctId,
    storeId: input.storeId,
    properties: { store_id: input.storeId, ...input.properties },
  },
});

/**
 * Records a test reservation's analytics event in its own short transaction,
 * for a write that has none to add it to; returns the row's ids, for
 * `ports.dispatchEffects`. Never throws: analytics never fail an action.
 */
export async function recordTestReservationEvent(effect: TestAnalyticsEffect): Promise<string[]> {
  try {
    return await db.transaction((tx) => enqueueEffects(tx, effect.payload.storeId, [effect]));
  } catch (error) {
    console.error("A test reservation's analytics event could not be recorded:", error);
    return [];
  }
}

/** What the dashboard's guide and home card read. */
export async function getTestReservationState(
  store: Pick<ActorStore, "id" | "settings">,
  now: Date = new Date(),
): Promise<GetTestReservationOutput> {
  const [found, [channel]] = await Promise.all([
    findStoreTestReservation(db, store.id),
    db
      .select({ id: storeMarketplaceChannels.id })
      .from(storeMarketplaceChannels)
      .where(eq(storeMarketplaceChannels.storeId, store.id))
      .limit(1),
  ]);
  // One past its lifetime is the cleanup's: the guide no longer shows it.
  const current = found && !isExpired(found.createdAt, now) ? found : null;
  const types = current
    ? (
        await db
          .select({ type: inspections.type })
          .from(inspections)
          .where(and(eq(inspections.reservationId, current.id), eq(inspections.storeId, store.id)))
      ).map((row) => row.type)
    : [];
  const inspection = store.settings?.inspection ?? DEFAULT_INSPECTION_SETTINGS;
  return {
    reservation: current
      ? {
          id: current.id,
          status: current.status,
          createdAt: current.createdAt,
          expiresAt: testReservationExpiresAt(current.createdAt),
        }
      : null,
    inspectionsEnabled: inspection.enabled === true,
    hasDepartureInspection: types.includes("departure"),
    hasReturnInspection: types.includes("return"),
    hasMarketplaceChannel: Boolean(channel),
  };
}

/**
 * Starts a test: the store's test reservation still running, or the
 * storefront's address that opens test mode for the user (two hours). An
 * expired test reservation is deleted first, so a store without the daily
 * cron (self-hosted) never keeps one past its lifetime.
 */
export async function startTestReservation(params: {
  store: Pick<ActorStore, "id" | "slug" | "userId">;
  userId: string;
  urls: UrlsPort;
  now?: Date;
}): Promise<{ result: { url: string } | { existing: string }; effectIds: string[] }> {
  const { store, userId, urls } = params;
  const now = params.now ?? new Date();
  const effectIds: string[] = [];

  const found = await findStoreTestReservation(db, store.id);
  if (found && !isExpired(found.createdAt, now)) {
    return { result: { existing: found.id }, effectIds };
  }
  if (found) {
    const purged = await deleteTestReservation({
      storeId: store.id,
      reservationId: found.id,
      analytics: { distinctId: store.userId, trigger: "expired" },
    });
    effectIds.push(...purged.effectIds);
  }

  const token = createTestModePass({ storeId: store.id, userId }, now.getTime());
  effectIds.push(
    ...(await recordTestReservationEvent(
      testReservationAnalytics("test_reservation_started", {
        storeId: store.id,
        distinctId: userId,
      }),
    )),
  );
  return {
    result: { url: urls.storefront(store.slug, `/test-mode?token=${encodeURIComponent(token)}`) },
    effectIds,
  };
}

/** The ids of a reservation's rows that other rows hang from. */
async function readDependentIds(tx: Transaction, reservationId: string) {
  const [items, inspectionRows, paymentRows] = await Promise.all([
    tx
      .select({ id: reservationItems.id })
      .from(reservationItems)
      .where(eq(reservationItems.reservationId, reservationId)),
    tx
      .select({ id: inspections.id })
      .from(inspections)
      .where(eq(inspections.reservationId, reservationId)),
    tx.select({ id: payments.id }).from(payments).where(eq(payments.reservationId, reservationId)),
  ]);
  const inspectionIds = inspectionRows.map((row) => row.id);
  const inspectionItemIds =
    inspectionIds.length > 0
      ? (
          await tx
            .select({ id: inspectionItems.id })
            .from(inspectionItems)
            .where(inArray(inspectionItems.inspectionId, inspectionIds))
        ).map((row) => row.id)
      : [];
  const photos =
    inspectionItemIds.length > 0
      ? await tx
          .select({
            photoKey: inspectionPhotos.photoKey,
            thumbnailKey: inspectionPhotos.thumbnailKey,
          })
          .from(inspectionPhotos)
          .where(inArray(inspectionPhotos.inspectionItemId, inspectionItemIds))
      : [];
  return {
    itemIds: items.map((row) => row.id),
    inspectionIds,
    inspectionItemIds,
    paymentIds: paymentRows.map((row) => row.id),
    fileKeys: photos.flatMap((photo) =>
      photo.thumbnailKey ? [photo.photoKey, photo.thumbnailKey] : [photo.photoKey],
    ),
  };
}

/** Deletes every row that hangs from the reservation, in its transaction. */
async function deleteReservationRows(
  tx: Transaction,
  storeId: string,
  reservationId: string,
  ids: Awaited<ReturnType<typeof readDependentIds>>,
) {
  const { itemIds, inspectionIds, inspectionItemIds, paymentIds } = ids;

  if (inspectionItemIds.length > 0) {
    await tx
      .delete(inspectionPhotos)
      .where(inArray(inspectionPhotos.inspectionItemId, inspectionItemIds));
    await tx
      .delete(inspectionFieldValues)
      .where(inArray(inspectionFieldValues.inspectionItemId, inspectionItemIds));
    await tx.delete(inspectionItems).where(inArray(inspectionItems.id, inspectionItemIds));
  }
  if (inspectionIds.length > 0) {
    await tx.delete(inspections).where(inArray(inspections.id, inspectionIds));
  }
  if (itemIds.length > 0) {
    await tx
      .delete(reservationItemUnits)
      .where(inArray(reservationItemUnits.reservationItemId, itemIds));
  }
  await tx
    .delete(reservationItemDetails)
    .where(eq(reservationItemDetails.reservationId, reservationId));
  await tx.delete(reservationItems).where(eq(reservationItems.reservationId, reservationId));

  // Simulated payments only: a test reservation never reaches Stripe or the invoices.
  await tx
    .delete(paymentRefundOperations)
    .where(eq(paymentRefundOperations.reservationId, reservationId));
  await tx.delete(paymentDisputes).where(eq(paymentDisputes.reservationId, reservationId));
  if (paymentIds.length > 0) await tx.delete(payments).where(inArray(payments.id, paymentIds));
  await tx.delete(paymentRequests).where(eq(paymentRequests.reservationId, reservationId));

  await tx.delete(reservationActivity).where(eq(reservationActivity.reservationId, reservationId));
  await tx
    .delete(reservationContractSignatures)
    .where(eq(reservationContractSignatures.reservationId, reservationId));
  await tx.delete(documents).where(eq(documents.reservationId, reservationId));
  await tx.delete(emailLogs).where(eq(emailLogs.reservationId, reservationId));
  await tx.delete(smsLogs).where(eq(smsLogs.reservationId, reservationId));
  await tx.delete(discordLogs).where(eq(discordLogs.reservationId, reservationId));
  await tx.delete(reminderLogs).where(eq(reminderLogs.reservationId, reservationId));
  await tx.delete(reviewRequestLogs).where(eq(reviewRequestLogs.reservationId, reservationId));
  await tx
    .delete(reservationCalendarEvents)
    .where(eq(reservationCalendarEvents.reservationId, reservationId));
  await tx
    .delete(marketplaceBookingAttempts)
    .where(eq(marketplaceBookingAttempts.reservationId, reservationId));
  // Its instant-access links to the customer's account.
  await tx.delete(verificationCodes).where(eq(verificationCodes.reservationId, reservationId));
  // Its outbox rows, but one a sender holds right now: that sender finds the
  // reservation gone and cancels it.
  await tx
    .delete(apiEffects)
    .where(and(eq(apiEffects.reservationId, reservationId), ne(apiEffects.status, "running")));
  await tx
    .delete(inboxAcknowledgements)
    .where(
      and(
        eq(inboxAcknowledgements.storeId, storeId),
        eq(inboxAcknowledgements.recordId, reservationId),
      ),
    );
  // A unit's history names the reservation it was assigned to in its payload, or
  // only the reservation's line.
  const namesThisReservation = sql`JSON_UNQUOTE(JSON_EXTRACT(${productUnitEvents.payload}, '$.reservationId')) = ${reservationId}`;
  await tx.delete(productUnitEvents).where(
    and(
      eq(productUnitEvents.storeId, storeId),
      inArray(productUnitEvents.type, ["assigned", "unassigned"]),
      itemIds.length > 0
        ? or(
            namesThisReservation,
            sql`JSON_UNQUOTE(JSON_EXTRACT(${productUnitEvents.payload}, '$.reservationItemId')) IN (${sql.join(
              itemIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
        : namesThisReservation,
    ),
  );
  // The storefront advisor's conversation stays, as when a customer is deleted.
  await tx
    .update(aiAdvisorConversations)
    .set({ reservationId: null })
    .where(eq(aiAdvisorConversations.reservationId, reservationId));

  await tx
    .delete(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)));
}

/**
 * Deletes the test customer once its last reservation is gone, with its
 * sessions and the rows that hang from it. A customer a real checkout made
 * real (`isTest` false), or one with another reservation, stays.
 *
 * Both are read under the customer's row lock, held to the commit: a real
 * checkout locks the customer before it turns it real and inserts its
 * reservation (`upsertCustomer`), so it either commits first and is seen
 * here, or waits for the deletion and adds the customer again. The lock
 * comes after the reservation's, as the checkout takes its customer after
 * the reservation it resumes (DL lock order: customers after reservations).
 * The transaction is READ COMMITTED (`runReservationChange`), so the reads
 * after the lock see what the checkout committed.
 */
async function deleteTestCustomer(tx: Transaction, storeId: string, customerId: string) {
  await lockCustomerRow(tx, customerId);
  const [customer] = await tx
    .select({ id: customers.id, email: customers.email, isTest: customers.isTest })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.storeId, storeId)))
    .limit(1);
  if (!customer?.isTest) return;
  const [other] = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(eq(reservations.customerId, customerId))
    .limit(1);
  if (other) return;

  await tx.delete(customerSessions).where(eq(customerSessions.customerId, customerId));
  await tx.delete(customerFieldValues).where(eq(customerFieldValues.customerId, customerId));
  await tx
    .delete(customerCommunicationPreferences)
    .where(eq(customerCommunicationPreferences.customerId, customerId));
  await tx
    .delete(apiEffects)
    .where(and(eq(apiEffects.customerId, customerId), ne(apiEffects.status, "running")));
  await tx.delete(emailLogs).where(eq(emailLogs.customerId, customerId));
  await tx.delete(smsLogs).where(eq(smsLogs.customerId, customerId));
  await tx
    .update(storefrontEvents)
    .set({ customerId: null })
    .where(eq(storefrontEvents.customerId, customerId));
  await tx
    .update(aiAdvisorConversations)
    .set({ customerId: null })
    .where(eq(aiAdvisorConversations.customerId, customerId));
  // Its sign-in codes, unless a real customer of the store shares its e-mail.
  const [namesake] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.storeId, storeId),
        eq(customers.email, customer.email),
        ne(customers.id, customerId),
      ),
    )
    .limit(1);
  if (!namesake) {
    await tx
      .delete(verificationCodes)
      .where(
        and(eq(verificationCodes.storeId, storeId), eq(verificationCodes.email, customer.email)),
      );
  }
  await tx.delete(customers).where(eq(customers.id, customerId));
}

/**
 * Deletes one test reservation and everything that hangs from it, in one
 * transaction under the reservation's locks (its products, then the
 * reservation: DL-12's order), then its test customer if nothing else is
 * left of it. Its stored files go to the outbox in the same transaction
 * (`testReservation.deleteFiles`), so a storage failure is retried and never
 * fails the deletion; so does its analytics event. A reservation that is not
 * a test one is refused as not found; one already gone answers
 * `deleted: false`. Returns the outbox rows to dispatch.
 *
 * Test reservations hold no stock and are never billed (no fee, no snapshot,
 * no invoice), so there is no stock to give back and no billing mark.
 */
export async function deleteTestReservation(params: {
  storeId: string;
  reservationId: string;
  analytics: { distinctId: string; trigger: "manual" | "expired" };
}): Promise<{ deleted: boolean; effectIds: string[] }> {
  const { storeId, reservationId } = params;
  try {
    return await runReservationChange({ reservationId, storeId }, async (tx) => {
      const [row] = await tx
        .select({ isTest: reservations.isTest, customerId: reservations.customerId })
        .from(reservations)
        .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)))
        .limit(1);
      if (!row) return { deleted: false, effectIds: [] };
      if (!row.isTest) throw reservationErrors.notFound(reservationId);

      const ids = await readDependentIds(tx, reservationId);
      await deleteReservationRows(tx, storeId, reservationId, ids);
      await deleteTestCustomer(tx, storeId, row.customerId);

      const effects: ApiEffect[] = [
        testReservationAnalytics("test_reservation_deleted", {
          storeId,
          distinctId: params.analytics.distinctId,
          properties: { trigger: params.analytics.trigger },
        }),
      ];
      if (ids.fileKeys.length > 0) {
        effects.push({ type: "testReservation.deleteFiles", payload: { keys: ids.fileKeys } });
      }
      return { deleted: true, effectIds: await enqueueEffects(tx, storeId, effects) };
    });
  } catch (error) {
    if (isReservationChangeBusyError(error)) throw reservationErrors.busy(reservationId);
    throw error;
  }
}

/**
 * The daily cleanup: deletes the test reservations created more than
 * `TEST_RESERVATION_LIFETIME_DAYS` ago, oldest first, at most `limit` a run.
 * Each is deleted on its own: one that fails is logged and left for the next
 * run. Reads through the one-per-store index (`test_store_id` is set only on
 * test rows).
 */
export async function purgeExpiredTestReservations(
  options: { now?: Date; limit?: number } = {},
): Promise<{ deleted: number; failed: number; effectIds: string[] }> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - TEST_RESERVATION_LIFETIME_DAYS * DAY_MS);
  const expired = await db
    .select({ id: reservations.id, storeId: reservations.storeId })
    .from(reservations)
    .where(and(isNotNull(reservations.testStoreId), lt(reservations.createdAt, cutoff)))
    .orderBy(asc(reservations.createdAt))
    .limit(options.limit ?? 100);

  const owners = expired.length
    ? await db.query.stores.findMany({
        where: (stores, { inArray: within }) =>
          within(
            stores.id,
            expired.map((row) => row.storeId),
          ),
        columns: { id: true, userId: true },
      })
    : [];
  const ownerOf = new Map(owners.map((store) => [store.id, store.userId]));

  let deleted = 0;
  let failed = 0;
  const effectIds: string[] = [];
  for (const row of expired) {
    try {
      const result = await deleteTestReservation({
        storeId: row.storeId,
        reservationId: row.id,
        analytics: { distinctId: ownerOf.get(row.storeId) ?? row.storeId, trigger: "expired" },
      });
      if (result.deleted) deleted += 1;
      effectIds.push(...result.effectIds);
    } catch (error) {
      failed += 1;
      console.error("An expired test reservation could not be deleted:", row.id, error);
    }
  }
  return { deleted, failed, effectIds };
}
