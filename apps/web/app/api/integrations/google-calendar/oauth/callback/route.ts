import { redirect } from 'next/navigation';

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  db,
  integrationCredentials,
  storeCalendarIntegrations,
  storeIntegrations,
} from '@louez/db';

import { auth } from '@/lib/auth';
import { enqueueCalendarBackfill } from '@/lib/integrations/calendar/sync';
import { encryptIntegrationSecret } from '@/lib/integrations/credentials';
import {
  GOOGLE_CALENDAR_CATEGORY,
  GOOGLE_CALENDAR_PROVIDER_KEY,
  createGoogleCalendar,
  exchangeGoogleCalendarCode,
  getGoogleAccountEmail,
} from '@/lib/integrations/providers/google-calendar/google-calendar-client';
import { parseGoogleCalendarOAuthState } from '@/lib/integrations/providers/google-calendar/oauth-state';
import { verifyStoreAccess } from '@/lib/store-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateValue = url.searchParams.get('state');
  const session = await auth();

  if (!code || !stateValue || !session?.user?.id) {
    redirect('/dashboard/settings/integrations/google-calendar?error=oauth');
  }

  const state = parseGoogleCalendarOAuthState(stateValue);
  if (!state || state.userId !== session.user.id) {
    redirect('/dashboard/settings/integrations/google-calendar?error=oauth');
  }

  const role = await verifyStoreAccess(state.storeId);
  if (role !== 'owner' && role !== 'platform_admin') {
    redirect(
      '/dashboard/settings/integrations/google-calendar?error=permissionDenied',
    );
  }

  const store = await db.query.stores.findFirst({
    where: (stores, { eq }) => eq(stores.id, state.storeId),
    columns: { id: true, name: true },
  });
  if (!store) {
    redirect(
      '/dashboard/settings/integrations/google-calendar?error=storeNotFound',
    );
  }

  const token = await exchangeGoogleCalendarCode(code);
  const accountEmail = await getGoogleAccountEmail(token.accessToken);
  const calendarName = `Louez - ${store.name}`;
  const calendar = await createGoogleCalendar({
    accessToken: token.accessToken,
    summary: calendarName,
  });
  const encryptedAccessToken = encryptIntegrationSecret(token.accessToken);
  const encryptedRefreshToken = encryptIntegrationSecret(token.refreshToken);
  const integrationId = nanoid();

  await db
    .insert(storeIntegrations)
    .values({
      id: integrationId,
      storeId: state.storeId,
      providerKey: GOOGLE_CALENDAR_PROVIDER_KEY,
      category: GOOGLE_CALENDAR_CATEGORY,
      enabled: true,
      connectedByUserId: session.user.id,
      providerAccountEmail: accountEmail,
      status: 'active',
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        enabled: true,
        connectedByUserId: session.user.id,
        providerAccountEmail: accountEmail,
        status: 'active',
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      },
    });

  const integration = await db.query.storeIntegrations.findFirst({
    where: and(
      eq(storeIntegrations.storeId, state.storeId),
      eq(storeIntegrations.providerKey, GOOGLE_CALENDAR_PROVIDER_KEY),
    ),
  });
  if (!integration) {
    redirect('/dashboard/settings/integrations/google-calendar?error=oauth');
  }

  await db
    .insert(integrationCredentials)
    .values({
      id: nanoid(),
      integrationId: integration.id,
      credentialKind: 'oauth',
      accessTokenEncrypted: encryptedAccessToken.encrypted,
      refreshTokenEncrypted: encryptedRefreshToken.encrypted,
      expiresAt: token.expiresAt,
      scopes: token.scopes,
      keyVersion: encryptedRefreshToken.keyVersion,
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        accessTokenEncrypted: encryptedAccessToken.encrypted,
        refreshTokenEncrypted: encryptedRefreshToken.encrypted,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
        keyVersion: encryptedRefreshToken.keyVersion,
        updatedAt: new Date(),
      },
    });

  await db
    .insert(storeCalendarIntegrations)
    .values({
      id: nanoid(),
      integrationId: integration.id,
      calendarId: calendar.id,
      calendarName: calendar.summary,
      syncPendingReservations: true,
      cancelledReservationBehavior: 'show',
      backfillMonths: 12,
      backfillPastDays: 30,
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        calendarId: calendar.id,
        calendarName: calendar.summary,
        updatedAt: new Date(),
      },
    });

  await enqueueCalendarBackfill({
    storeId: state.storeId,
    integrationId: integration.id,
    futureMonths: 12,
    pastDays: 30,
  });

  redirect(`${state.returnTo}?connected=google-calendar`);
}
