import { Suspense } from 'react';

import { redirect } from 'next/navigation';

import type { StoreSettings } from '@louez/types';

import { ReservationPollingProvider } from '@/components/dashboard/reservation-polling-provider';
import { MobileHeader, Sidebar } from '@/components/dashboard/sidebar';
import { WelcomeOverlay } from '@/components/dashboard/welcome-overlay';

import { auth } from '@/lib/auth';
import { getCurrentStore, getUserStores } from '@/lib/store-context';
import { getCurrentPlanSlug } from '@/lib/stripe/subscriptions';

import { StoreProvider } from '@/contexts/store-context';

export default async function DashboardMainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  // Get all user's stores
  const userStores = await getUserStores();

  // If no stores, redirect to onboarding
  if (userStores.length === 0) {
    redirect('/onboarding');
  }

  // Get current active store
  const store = await getCurrentStore();

  // If no store or onboarding not completed, redirect to onboarding
  if (!store || !store.onboardingCompleted) {
    redirect('/onboarding');
  }

  // Get current plan for the store
  const planSlug = await getCurrentPlanSlug(store.id);
  const settings = (store.settings as StoreSettings) || {};

  return (
    <StoreProvider
      currency={settings.currency || 'EUR'}
      storeSlug={store.slug}
      storeName={store.name}
      timezone={settings.timezone}
    >
      <ReservationPollingProvider interval={30000}>
        <div className="dashboard bg-muted/30 min-h-screen">
          <Sidebar
            stores={userStores}
            currentStoreId={store.id}
            storeSlug={store.slug}
            userEmail={session.user.email || ''}
            userImage={session.user.image}
            planSlug={planSlug}
          />
          <MobileHeader
            stores={userStores}
            currentStoreId={store.id}
            storeSlug={store.slug}
            userEmail={session.user.email || ''}
            userImage={session.user.image}
            planSlug={planSlug}
          />
          <main className="lg:pl-64">
            <div className="px-4 py-6 sm:px-6 lg:px-8">{children}</div>
          </main>
          <Suspense fallback={null}>
            <WelcomeOverlay />
          </Suspense>
        </div>
      </ReservationPollingProvider>
    </StoreProvider>
  );
}
