import { redirect } from 'next/navigation';

import { eq } from 'drizzle-orm';

import { db, users } from '@louez/db';

import { auth } from '@/lib/auth';
import { isCurrentUserPlatformAdmin } from '@/lib/platform-admin';
import { getCurrentStore, getUserStores } from '@/lib/store-context';

import { StoreOnboardingClientPage } from './store-onboarding-client-page';

export default async function OnboardingStorePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  // First things first: meet the user before their store.
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  });
  if (!user?.profileCompletedAt) {
    redirect('/onboarding/profile');
  }

  const [currentStore, isPlatformAdmin] = await Promise.all([
    getCurrentStore(),
    isCurrentUserPlatformAdmin(),
  ]);
  const stores = isPlatformAdmin ? await getUserStores() : [];
  const currentStoreId = currentStore?.id ?? stores[0]?.id ?? null;

  return (
    <StoreOnboardingClientPage
      stores={stores}
      currentStoreId={isPlatformAdmin ? currentStoreId : null}
    />
  );
}
