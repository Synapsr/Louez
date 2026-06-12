import { and, eq } from 'drizzle-orm';

import {
  db,
  reservationCalendarEvents,
  storeCalendarIntegrations,
  storeIntegrations,
} from '@louez/db';

import { GOOGLE_CALENDAR_PROVIDER_KEY } from '@/lib/integrations/providers/google-calendar/google-calendar-client';

export const ICS_CALENDAR_PROVIDER_KEY = 'ics-calendar';

export type CalendarIntegrationState = {
  storeId: string;
  google: {
    enabled: boolean;
    connected: boolean;
    configured: boolean;
    status: string;
    accountEmail: string | null;
    calendarName: string | null;
    lastSyncAt: string | null;
    lastError: string | null;
    syncPendingReservations: boolean;
    cancelledReservationBehavior: 'show' | 'hide';
    pendingEvents: number;
    failedEvents: number;
  };
  ics: {
    token: string | null;
    connected: boolean;
  };
};

export async function getGoogleCalendarIntegrationForStore(storeId: string) {
  return db.query.storeIntegrations.findFirst({
    where: and(
      eq(storeIntegrations.storeId, storeId),
      eq(storeIntegrations.providerKey, GOOGLE_CALENDAR_PROVIDER_KEY),
    ),
    with: {
      calendarSettings: true,
      credentials: true,
    },
  });
}

export async function getCalendarIntegrationState(params: {
  storeId: string;
  icsToken: string | null;
}): Promise<CalendarIntegrationState> {
  const google = await getGoogleCalendarIntegrationForStore(params.storeId);
  let pendingEvents = 0;
  let failedEvents = 0;

  if (google) {
    const rows = await db
      .select({
        syncStatus: reservationCalendarEvents.syncStatus,
      })
      .from(reservationCalendarEvents)
      .where(eq(reservationCalendarEvents.integrationId, google.id));

    pendingEvents = rows.filter((row) => row.syncStatus === 'pending').length;
    failedEvents = rows.filter((row) => row.syncStatus === 'failed').length;
  }

  return {
    storeId: params.storeId,
    google: {
      enabled: google?.enabled ?? false,
      connected: Boolean(google?.credentials?.refreshTokenEncrypted),
      configured: Boolean(google?.calendarSettings?.calendarId),
      status: google?.status ?? 'disabled',
      accountEmail: google?.providerAccountEmail ?? null,
      calendarName: google?.calendarSettings?.calendarName ?? null,
      lastSyncAt: google?.calendarSettings?.lastSyncAt?.toISOString() ?? null,
      lastError: google?.lastErrorMessage ?? null,
      syncPendingReservations:
        google?.calendarSettings?.syncPendingReservations ?? true,
      cancelledReservationBehavior:
        google?.calendarSettings?.cancelledReservationBehavior ?? 'show',
      pendingEvents,
      failedEvents,
    },
    ics: {
      token: params.icsToken,
      connected: Boolean(params.icsToken),
    },
  };
}

export async function updateGoogleCalendarSettings(params: {
  storeId: string;
  syncPendingReservations: boolean;
  cancelledReservationBehavior: 'show' | 'hide';
}): Promise<{ success: true } | { error: string }> {
  const integration = await db.query.storeIntegrations.findFirst({
    where: and(
      eq(storeIntegrations.storeId, params.storeId),
      eq(storeIntegrations.providerKey, GOOGLE_CALENDAR_PROVIDER_KEY),
    ),
  });

  if (!integration) {
    return { error: 'errors.integrationNotFound' };
  }

  await db
    .update(storeCalendarIntegrations)
    .set({
      syncPendingReservations: params.syncPendingReservations,
      cancelledReservationBehavior: params.cancelledReservationBehavior,
      updatedAt: new Date(),
    })
    .where(eq(storeCalendarIntegrations.integrationId, integration.id));

  return { success: true };
}
