import { and, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  db,
  integrationCredentials,
  reservationCalendarEvents,
  reservations,
  storeCalendarIntegrations,
  storeIntegrations,
} from '@louez/db';

import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from '@/lib/integrations/credentials';
import {
  GOOGLE_CALENDAR_PROVIDER_KEY,
  GoogleCalendarApiError,
  deleteGoogleCalendarEvent,
  insertGoogleCalendarEvent,
  refreshGoogleCalendarAccessToken,
  updateGoogleCalendarEvent,
} from '@/lib/integrations/providers/google-calendar/google-calendar-client';

import { buildReservationCalendarEventPayload } from './calendar-event-payload';

const MAX_ATTEMPTS = 8;
const IMMEDIATE_BACKFILL_SYNC_LIMIT = 10;

function isMissingProviderEvent(error: unknown): boolean {
  return (
    error instanceof GoogleCalendarApiError &&
    (error.status === 404 || error.status === 410)
  );
}

async function processCalendarSyncQueueImmediately(
  limit: number,
  context: string,
): Promise<void> {
  const result = await processCalendarSyncQueue(limit);

  if (result.failed > 0) {
    console.warn('[calendar] Immediate sync left failed events for retry', {
      context,
      ...result,
    });
  }
}

function getRetryDate(attemptCount: number): Date {
  const delayMinutes = Math.min(24 * 60, 2 ** Math.max(0, attemptCount));
  return new Date(Date.now() + delayMinutes * 60 * 1000);
}

export async function markReservationForCalendarSync(
  storeId: string,
  reservationId: string,
): Promise<void> {
  const integrations = await db
    .select({ integrationId: storeIntegrations.id })
    .from(storeIntegrations)
    .innerJoin(
      storeCalendarIntegrations,
      eq(storeCalendarIntegrations.integrationId, storeIntegrations.id),
    )
    .where(
      and(
        eq(storeIntegrations.storeId, storeId),
        eq(storeIntegrations.category, 'calendar'),
        eq(storeIntegrations.enabled, true),
        inArray(storeIntegrations.status, ['active', 'error', 'syncing']),
        eq(storeIntegrations.providerKey, GOOGLE_CALENDAR_PROVIDER_KEY),
      ),
    );

  let enqueued = 0;

  for (const integration of integrations) {
    await db
      .insert(reservationCalendarEvents)
      .values({
        id: nanoid(),
        reservationId,
        integrationId: integration.integrationId,
        syncStatus: 'pending',
        attemptCount: 0,
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          syncStatus: 'pending',
          attemptCount: 0,
          nextAttemptAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        },
      });
    enqueued++;
  }

  if (enqueued > 0) {
    await processCalendarSyncQueueImmediately(enqueued, 'reservation_enqueued');
  }
}

export async function enqueueCalendarBackfill(params: {
  storeId: string;
  integrationId: string;
  futureMonths: number;
  pastDays: number;
}): Promise<{ enqueued: number }> {
  const now = new Date();
  const futureUntil = new Date(now);
  futureUntil.setMonth(futureUntil.getMonth() + params.futureMonths);
  const pastSince = new Date(now);
  pastSince.setDate(pastSince.getDate() - params.pastDays);

  const rows = await db
    .select({ reservationId: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, params.storeId),
        or(
          and(lte(reservations.startDate, now), gte(reservations.endDate, now)),
          and(
            gte(reservations.startDate, now),
            lte(reservations.startDate, futureUntil),
          ),
          and(
            gte(reservations.startDate, pastSince),
            lte(reservations.startDate, now),
          ),
        ),
      ),
    );

  for (const row of rows) {
    await db
      .insert(reservationCalendarEvents)
      .values({
        id: nanoid(),
        reservationId: row.reservationId,
        integrationId: params.integrationId,
        syncStatus: 'pending',
        attemptCount: 0,
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          syncStatus: 'pending',
          attemptCount: 0,
          nextAttemptAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        },
      });
  }

  if (rows.length > 0) {
    await processCalendarSyncQueueImmediately(
      Math.min(rows.length, IMMEDIATE_BACKFILL_SYNC_LIMIT),
      'calendar_backfill_enqueued',
    );
  }

  return { enqueued: rows.length };
}

async function getAccessTokenForIntegration(params: {
  integrationId: string;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
}): Promise<string> {
  if (
    params.accessTokenEncrypted &&
    params.expiresAt &&
    params.expiresAt.getTime() > Date.now() + 60_000
  ) {
    return decryptIntegrationSecret(params.accessTokenEncrypted);
  }

  if (!params.refreshTokenEncrypted) {
    throw new Error('Google Calendar refresh token is missing');
  }

  const refreshToken = decryptIntegrationSecret(params.refreshTokenEncrypted);
  const refreshed = await refreshGoogleCalendarAccessToken(refreshToken);
  const encryptedAccessToken = encryptIntegrationSecret(refreshed.accessToken);

  await db
    .update(integrationCredentials)
    .set({
      accessTokenEncrypted: encryptedAccessToken.encrypted,
      expiresAt: refreshed.expiresAt,
      scopes: refreshed.scopes,
      keyVersion: encryptedAccessToken.keyVersion,
      updatedAt: new Date(),
    })
    .where(eq(integrationCredentials.integrationId, params.integrationId));

  return refreshed.accessToken;
}

async function processCalendarEvent(row: {
  id: string;
  reservationId: string;
  integrationId: string;
  providerEventId: string | null;
  attemptCount: number;
  calendarId: string | null;
  syncPendingReservations: boolean;
  cancelledReservationBehavior: 'show' | 'hide';
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
}): Promise<void> {
  if (!row.calendarId) {
    throw new Error('Calendar destination is not configured');
  }

  const payload = await buildReservationCalendarEventPayload({
    reservationId: row.reservationId,
    syncPendingReservations: row.syncPendingReservations,
    cancelledReservationBehavior: row.cancelledReservationBehavior,
  });
  const accessToken = await getAccessTokenForIntegration({
    integrationId: row.integrationId,
    accessTokenEncrypted: row.accessTokenEncrypted,
    refreshTokenEncrypted: row.refreshTokenEncrypted,
    expiresAt: row.expiresAt,
  });

  if (payload.shouldDelete) {
    if (row.providerEventId) {
      await deleteGoogleCalendarEvent({
        accessToken,
        calendarId: row.calendarId,
        eventId: row.providerEventId,
      });
    }

    await db
      .update(reservationCalendarEvents)
      .set({
        providerEventId: null,
        payloadHash: payload.payloadHash,
        syncStatus: 'synced',
        lastSyncedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(reservationCalendarEvents.id, row.id));
    return;
  }

  if (!payload.event) {
    throw new Error('Calendar event payload is missing');
  }

  let providerEvent: { id: string };

  if (row.providerEventId) {
    try {
      providerEvent = await updateGoogleCalendarEvent({
        accessToken,
        calendarId: row.calendarId,
        eventId: row.providerEventId,
        event: payload.event,
      });
    } catch (error) {
      if (!isMissingProviderEvent(error)) {
        throw error;
      }

      providerEvent = await insertGoogleCalendarEvent({
        accessToken,
        calendarId: row.calendarId,
        event: payload.event,
      });
    }
  } else {
    providerEvent = await insertGoogleCalendarEvent({
      accessToken,
      calendarId: row.calendarId,
      event: payload.event,
    });
  }

  await db
    .update(reservationCalendarEvents)
    .set({
      providerEventId: providerEvent.id,
      payloadHash: payload.payloadHash,
      syncStatus: 'synced',
      lastSyncedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(reservationCalendarEvents.id, row.id));

  await db
    .update(storeCalendarIntegrations)
    .set({ lastSyncAt: new Date(), updatedAt: new Date() })
    .where(eq(storeCalendarIntegrations.integrationId, row.integrationId));

  await db
    .update(storeIntegrations)
    .set({
      status: 'active',
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(storeIntegrations.id, row.integrationId));
}

export async function processCalendarSyncQueue(limit = 25): Promise<{
  processed: number;
  synced: number;
  failed: number;
}> {
  const dueRows = await db
    .select({
      id: reservationCalendarEvents.id,
      reservationId: reservationCalendarEvents.reservationId,
      integrationId: reservationCalendarEvents.integrationId,
      providerEventId: reservationCalendarEvents.providerEventId,
      attemptCount: reservationCalendarEvents.attemptCount,
      calendarId: storeCalendarIntegrations.calendarId,
      syncPendingReservations:
        storeCalendarIntegrations.syncPendingReservations,
      cancelledReservationBehavior:
        storeCalendarIntegrations.cancelledReservationBehavior,
      accessTokenEncrypted: integrationCredentials.accessTokenEncrypted,
      refreshTokenEncrypted: integrationCredentials.refreshTokenEncrypted,
      expiresAt: integrationCredentials.expiresAt,
    })
    .from(reservationCalendarEvents)
    .innerJoin(
      storeIntegrations,
      eq(storeIntegrations.id, reservationCalendarEvents.integrationId),
    )
    .innerJoin(
      storeCalendarIntegrations,
      eq(storeCalendarIntegrations.integrationId, storeIntegrations.id),
    )
    .innerJoin(
      integrationCredentials,
      eq(integrationCredentials.integrationId, storeIntegrations.id),
    )
    .where(
      and(
        inArray(reservationCalendarEvents.syncStatus, ['pending', 'failed']),
        lte(reservationCalendarEvents.nextAttemptAt, new Date()),
        eq(storeIntegrations.enabled, true),
        eq(storeIntegrations.providerKey, GOOGLE_CALENDAR_PROVIDER_KEY),
      ),
    )
    .limit(limit);

  let synced = 0;
  let failed = 0;

  for (const row of dueRows) {
    try {
      await processCalendarEvent(row);
      synced++;
    } catch (error) {
      failed++;
      const nextAttemptCount = row.attemptCount + 1;
      const message = error instanceof Error ? error.message : 'Unknown error';

      await db
        .update(reservationCalendarEvents)
        .set({
          syncStatus: nextAttemptCount >= MAX_ATTEMPTS ? 'failed' : 'failed',
          attemptCount: nextAttemptCount,
          nextAttemptAt: getRetryDate(nextAttemptCount),
          lastError: message,
          updatedAt: new Date(),
        })
        .where(eq(reservationCalendarEvents.id, row.id));

      if (message.includes('refresh') || message.includes('token')) {
        await db
          .update(storeIntegrations)
          .set({
            status: 'needs_reconnect',
            lastErrorCode: 'google_calendar_reconnect_required',
            lastErrorMessage: message,
            updatedAt: new Date(),
          })
          .where(eq(storeIntegrations.id, row.integrationId));
      } else {
        await db
          .update(storeIntegrations)
          .set({
            status: 'error',
            lastErrorCode: 'google_calendar_sync_failed',
            lastErrorMessage: message,
            updatedAt: new Date(),
          })
          .where(eq(storeIntegrations.id, row.integrationId));
      }
    }
  }

  return {
    processed: dueRows.length,
    synced,
    failed,
  };
}
