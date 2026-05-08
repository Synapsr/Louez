import { Suspense } from 'react';

import { redirect } from 'next/navigation';

import type { StoreSettings } from '@louez/types';
import {
  Separator,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@louez/ui';

import { DashboardBreadcrumbs } from '@/components/dashboard/dashboard-breadcrumbs';
import { DashboardBreadcrumbsProvider } from '@/components/dashboard/dashboard-breadcrumbs-context';
import { DashboardHeaderActions } from '@/components/dashboard/dashboard-header-actions';
import { ReservationPollingProvider } from '@/components/dashboard/reservation-polling-provider';
import { DashboardSidebar } from '@/components/dashboard/sidebar';
import { WelcomeOverlay } from '@/components/dashboard/welcome-overlay';

import { isAIChatConfigured } from '@/lib/ai/provider';
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

  const settings = (store.settings as StoreSettings) || {};
  const showAIChat = isAIChatConfigured();

  // Get current plan for the store
  const planSlug = await getCurrentPlanSlug(store.id);

  return (
    <StoreProvider
      currency={settings.currency || 'EUR'}
      storeSlug={store.slug}
      storeName={store.name}
      timezone={settings.timezone}
    >
      <ReservationPollingProvider interval={30000}>
        <div className="dashboard min-h-screen">
          <SidebarProvider>
            <DashboardBreadcrumbsProvider>
              <DashboardSidebar
                planSlug={planSlug}
                stores={userStores}
                currentStoreId={store.id}
                storeSlug={store.slug}
                userEmail={session.user.email || ''}
                userImage={session.user.image}
              />
              <SidebarInset className="overflow-x-hidden">
                <header className="bg-background/90 supports-backdrop-filter:bg-background/70 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-2.5 backdrop-blur">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <SidebarTrigger className="-ml-1 shrink-0" />
                    <Separator orientation="vertical" className="h-4 shrink-0" />
                    <DashboardBreadcrumbs />
                  </div>
                  <DashboardHeaderActions showAIChat={showAIChat} />
                </header>
                <div className="px-4 py-6 sm:px-6 lg:px-8">{children}</div>
              </SidebarInset>
            </DashboardBreadcrumbsProvider>
          </SidebarProvider>
          <Suspense fallback={null}>
            <WelcomeOverlay />
          </Suspense>
        </div>
      </ReservationPollingProvider>
    </StoreProvider>
  );
}
