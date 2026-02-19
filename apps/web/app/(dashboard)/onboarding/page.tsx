import { isCurrentUserPlatformAdmin } from '@/lib/platform-admin';
import { getCurrentStore, getUserStores } from '@/lib/store-context';

import { StoreOnboardingClientPage } from './store-onboarding-client-page';

export default async function OnboardingStorePage() {
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
