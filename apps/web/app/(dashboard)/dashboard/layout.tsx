import { Suspense } from "react";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db, users } from "@louez/db";
import type { StoreSettings } from "@louez/types";
import { Separator, SidebarInset, SidebarProvider } from "@louez/ui";

import { DashboardBreadcrumbs } from "@/components/dashboard/dashboard-breadcrumbs";
import { DashboardBreadcrumbsProvider } from "@/components/dashboard/dashboard-breadcrumbs-context";
import { DashboardHeaderActions } from "@/components/dashboard/dashboard-header-actions";
import { DashboardSidebarTrigger } from "@/components/dashboard/dashboard-sidebar-trigger";
import { DashboardThemeShortcut } from "@/components/dashboard/dashboard-theme-shortcut";
import { ReservationPollingProvider } from "@/components/dashboard/reservation-polling-provider";
import { SettingsSearchFocus } from "@/components/dashboard/settings-search-focus";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { StarPrompt } from "@/components/dashboard/star-prompt";
import { WelcomeOverlay } from "@/components/dashboard/welcome-overlay";
import { DashboardSaveShortcut } from "@/components/shared/dashboard-save-shortcut";
import { KeyboardShortcutsProvider } from "@/components/shared/keyboard-shortcuts-provider";
import { WhatsNewProvider } from "@/components/shared/whats-new-provider";

import { getAiCreditsInfo, hasEverUsedAiCredits, microToCredits } from "@/lib/ai/advisor/credits";
import { isAIChatConfigured } from "@/lib/ai/provider";
import { auth } from "@/lib/auth";
import { isStandaloneMode } from "@/lib/deployment";
import { parseKeyboardShortcutOverrides } from "@/lib/keyboard-shortcuts";
import { getStoreLimits, getStorePlan } from "@/lib/plan-limits";
import { areAiCreditsEnabled } from "@/lib/plans";
import { isElectronicInvoicingEnabled } from "@/lib/invoicing/feature";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import { getCurrentStore, getUserStores } from "@/lib/store-context";
import { getCurrentPlanSlug } from "@/lib/stripe/subscriptions";
import { parseWhatsNewProgress } from "@/lib/whats-new.progress";

import { StoreProvider } from "@/contexts/store-context";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** Total balance under which the sidebar shows its low-credit marker. */
const LOW_AI_CREDITS_THRESHOLD = 5;

/**
 * Wallet state for the sidebar entry. The paid credit layer is cloud-only, so
 * self-hosted deployments never pay for the query — nor get the nav entry.
 */
const getSidebarAiCredits = async (
  storeId: string,
): Promise<{ low: boolean; credits: number | null; hasUsedCredits: boolean } | null> => {
  if (!areAiCreditsEnabled()) return null;
  const [plan, hasUsedCredits] = await Promise.all([
    getStorePlan(storeId),
    hasEverUsedAiCredits(storeId),
  ]);
  const info = await getAiCreditsInfo(storeId, plan);
  const total =
    info.monthlyRemainingMicro === null
      ? null
      : microToCredits(info.monthlyRemainingMicro + info.prepaidBalanceMicro);
  return {
    low: total !== null && total < LOW_AI_CREDITS_THRESHOLD,
    credits: total,
    hasUsedCredits,
  };
};

export default async function DashboardMainLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  // Get all user's stores
  const userStores = await getUserStores();

  // If no stores, redirect to onboarding
  if (userStores.length === 0) {
    redirect("/onboarding");
  }

  // Get current active store
  const store = await getCurrentStore();

  // If no store or onboarding not completed, redirect to onboarding
  if (!store || !store.onboardingCompleted) {
    redirect("/onboarding");
  }

  const settings = (store.settings as StoreSettings) || {};
  const showAIChat = isAIChatConfigured();

  // Get current plan for the store
  const [planSlug, limits, isPlatformAdmin, userPreferences, aiCredits, electronicInvoicingEnabled] = await Promise.all([
    getCurrentPlanSlug(store.id),
    getStoreLimits(store.id),
    isCurrentUserPlatformAdmin(),
    db.query.users.findFirst({
      columns: {
        keyboardShortcuts: true,
        whatsNewProgress: true,
      },
      where: eq(users.id, session.user.id),
    }),
    getSidebarAiCredits(store.id),
    isElectronicInvoicingEnabled(store.id),
  ]);

  return (
    <KeyboardShortcutsProvider
      initialShortcuts={parseKeyboardShortcutOverrides(userPreferences?.keyboardShortcuts)}
    >
      <WhatsNewProvider initialProgress={parseWhatsNewProgress(userPreferences?.whatsNewProgress)}>
        <DashboardSaveShortcut />
        <DashboardThemeShortcut />
        <StoreProvider
          currency={settings.currency || "EUR"}
          storeSlug={store.slug}
          storeName={store.name}
          timezone={settings.timezone}
        >
          <ReservationPollingProvider interval={30000}>
            <div className="dashboard relative h-svh overflow-hidden">
              <SidebarProvider className="h-full min-h-0 overflow-hidden">
                <DashboardBreadcrumbsProvider>
                  <DashboardSidebar
                    planSlug={planSlug}
                    stores={userStores}
                    currentStoreId={store.id}
                    storeSlug={store.slug}
                    userId={session.user.id}
                    userEmail={session.user.email || ""}
                    userImage={session.user.image}
                    isPlatformAdmin={isPlatformAdmin}
                    aiCredits={aiCredits}
                  />
                  <SidebarInset className="min-h-0 min-w-0 overflow-clip">
                    <header className="bg-background/90 supports-backdrop-filter:bg-background/70 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-2.5 backdrop-blur">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <DashboardSidebarTrigger />
                        <Separator orientation="vertical" className="h-4 shrink-0" />
                        <DashboardBreadcrumbs />
                      </div>
                      <DashboardHeaderActions
                        showAIChat={showAIChat}
                        reservationLimits={limits.reservationsThisMonth}
                        planSlug={planSlug}
                        isPlatformAdmin={isPlatformAdmin}
                        electronicInvoicingEnabled={electronicInvoicingEnabled}
                      />
                    </header>
                    <div
                      data-dashboard-content
                      className="min-h-0 flex-1 overflow-x-clip overflow-y-auto overscroll-contain px-4 sm:px-6 lg:px-8"
                    >
                      <div className="min-h-full py-4 pb-2 md:py-6">{children}</div>
                    </div>
                  </SidebarInset>
                </DashboardBreadcrumbsProvider>
              </SidebarProvider>
              <Suspense fallback={null}>
                <WelcomeOverlay />
                <SettingsSearchFocus />
                {/* Self-hosted instances only: the cloud never asks. */}
                {isStandaloneMode() && <StarPrompt />}
              </Suspense>
            </div>
          </ReservationPollingProvider>
        </StoreProvider>
      </WhatsNewProvider>
    </KeyboardShortcutsProvider>
  );
}
