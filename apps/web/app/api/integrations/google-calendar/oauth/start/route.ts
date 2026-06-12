import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { buildGoogleCalendarAuthorizationUrl } from '@/lib/integrations/providers/google-calendar/google-calendar-client';
import { createGoogleCalendarOAuthState } from '@/lib/integrations/providers/google-calendar/oauth-state';
import { isPlatformAdmin } from '@/lib/platform-admin';
import { getCurrentStore } from '@/lib/store-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await auth();
  const store = await getCurrentStore();
  const returnTo =
    new URL(request.url).searchParams.get('returnTo') ||
    '/dashboard/settings/integrations/google-calendar';

  if (!session?.user?.id || !store) {
    redirect('/login');
  }

  const canManageIntegration =
    store.role === 'owner' ||
    store.role === 'platform_admin' ||
    isPlatformAdmin(session.user.email);

  if (!canManageIntegration) {
    redirect('/dashboard/settings/integrations?error=permissionDenied');
  }

  const state = createGoogleCalendarOAuthState({
    storeId: store.id,
    userId: session.user.id,
    returnTo,
  });

  try {
    redirect(buildGoogleCalendarAuthorizationUrl(state));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Google Calendar OAuth is not configured'
    ) {
      redirect(
        '/dashboard/settings/integrations/google-calendar?error=googleCalendarNotConfigured',
      );
    }

    throw error;
  }
}
