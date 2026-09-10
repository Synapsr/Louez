import type { ReactNode } from "react";

import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";

import type { StoreSettings } from "@louez/types";

import { OpenReplayProvider } from "@/components/openreplay-provider";
import { PostHogProvider } from "@/components/posthog-provider";
import { QuickAddProvider } from "@/components/storefront/product/quick-add-provider";
import { AdvisorProvider } from "@/contexts/advisor-context";
import { AnalyticsProvider } from "@/contexts/analytics-context";
import { CatalogNavigationProvider } from "@/contexts/catalog-navigation-context";
import { CartProvider } from "@/contexts/cart-context";
import { StoreProvider } from "@/contexts/store-context";
import { StorefrontSearchProvider } from "@/contexts/storefront-search-context";
import type { StorefrontStore } from "@/lib/storefront/get-store-by-slug";
import { getStorePeriodRules } from "@/lib/utils/util.store-period-rules";

export type StorefrontShellVariant = "store" | "marketplace" | "bare";

interface StorefrontProvidersProps {
  store: StorefrontStore;
  variant: StorefrontShellVariant;
  basePath: string;
  messages: AbstractIntlMessages;
  advisorEnabled: boolean;
  children: ReactNode;
}

/**
 * The one provider tree of the storefront. `bare` (embed) keeps only the
 * store context and translations: no analytics, cart or advisor inside an
 * iframe. `marketplace` tags analytics and PostHog with the channel.
 */
export const StorefrontProviders = ({
  store,
  variant,
  basePath,
  messages,
  advisorEnabled,
  children,
}: StorefrontProvidersProps) => {
  const settings: Partial<StoreSettings> = store.settings ?? {};
  const storeProvider = (content: ReactNode) => (
    <StoreProvider
      storeId={store.id}
      currency={settings.currency || "EUR"}
      storeSlug={store.slug}
      storeName={store.name}
      timezone={settings.timezone}
      maxDiscountPercent={store.theme?.maxDiscountPercent}
      basePath={basePath}
      periodRules={getStorePeriodRules(settings)}
    >
      <CatalogNavigationProvider>{content}</CatalogNavigationProvider>
    </StoreProvider>
  );

  if (variant === "bare") {
    return (
      <NextIntlClientProvider messages={messages}>{storeProvider(children)}</NextIntlClientProvider>
    );
  }

  const channel = variant === "marketplace" ? "marketplace" : undefined;

  return (
    <NextIntlClientProvider messages={messages}>
      <PostHogProvider channel={channel}>
        <OpenReplayProvider
          surface="storefront"
          store={{ id: store.id, name: store.name, slug: store.slug }}
        >
          {storeProvider(
            <StorefrontSearchProvider>
              <CartProvider>
                <AnalyticsProvider storeSlug={store.slug} channel={channel}>
                  <AdvisorProvider
                    storeSlug={store.slug}
                    enabled={advisorEnabled}
                    displayName={store.aiAdvisorSettings?.displayName}
                    welcomeMessage={store.aiAdvisorSettings?.welcomeMessage}
                  >
                    <QuickAddProvider>{children}</QuickAddProvider>
                  </AdvisorProvider>
                </AnalyticsProvider>
              </CartProvider>
            </StorefrontSearchProvider>,
          )}
        </OpenReplayProvider>
      </PostHogProvider>
    </NextIntlClientProvider>
  );
};
