import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { db } from "@louez/db";
import { stores } from "@louez/db";
import { eq } from "drizzle-orm";
import { AdvisorWidget } from "@/components/storefront/advisor/advisor-widget";
import { StoreHeaderWrapper } from "@/components/storefront/store-header-wrapper";
import { StoreFooter } from "@/components/storefront/store-footer";
import { ThemeWrapper } from "@/components/storefront/theme-wrapper";
import { AdvisorProvider } from "@/contexts/advisor-context";
import { CartProvider } from "@/contexts/cart-context";
import { StoreProvider } from "@/contexts/store-context";
import { AnalyticsProvider } from "@/contexts/analytics-context";
import { OpenReplayProvider } from "@/components/openreplay-provider";
import { PostHogProvider } from "@/components/posthog-provider";
import { MarketplaceStorefrontShell } from "@/components/storefront/marketplace-storefront-shell";
import { env } from "@/env";
import { isAdvisorActiveForStore } from "@/lib/ai/advisor/eligibility";
import type { StoreTheme, StoreSettings } from "@louez/types";

interface StorefrontLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export const StorefrontLayoutContent = async ({ children, params }: StorefrontLayoutProps) => {
  const { slug } = await params;

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  });

  if (!store || !store.onboardingCompleted) {
    notFound();
  }

  const messages = await getMessages();

  const theme = (store.theme as StoreTheme) || { mode: "light", primaryColor: "#0066FF" };
  const settings = (store.settings as StoreSettings) || {};
  const currency = settings.currency || "EUR";

  // AI advisor: opt-in per store, requires the platform AI config and the
  // plan feature. Never rendered in embed mode.
  const advisorSettings = store.aiAdvisorSettings;
  const advisorEnabled = await isAdvisorActiveForStore(store);

  // Detect embed mode from proxy header or URL path
  const headersList = await headers();
  const isEmbed =
    headersList.get("x-embed-mode") === "1" ||
    headersList.get("x-next-url")?.includes("/embed") ||
    headersList.get("x-invoke-path")?.includes("/embed");
  const isMarketplaceChannel = headersList.get("x-sales-channel") === "marketplace";

  // Embed mode: minimal layout without header/footer/analytics.
  // Transparent background lets the host site's background show through the iframe.
  if (isEmbed) {
    return (
      <NextIntlClientProvider messages={messages}>
        <StoreProvider
          storeId={store.id}
          currency={currency}
          storeSlug={store.slug}
          storeName={store.name}
          timezone={settings.timezone}
          maxDiscountPercent={theme.maxDiscountPercent}
        >
          <ThemeWrapper mode={theme.mode} primaryColor={theme.primaryColor}>
            <style>{`html, body { background: transparent !important; }`}</style>
            {children}
          </ThemeWrapper>
        </StoreProvider>
      </NextIntlClientProvider>
    );
  }

  if (isMarketplaceChannel) {
    return (
      <NextIntlClientProvider messages={messages}>
        <PostHogProvider channel="marketplace">
          <OpenReplayProvider
            surface="storefront"
            store={{ id: store.id, name: store.name, slug: store.slug }}
          >
            <StoreProvider
              storeId={store.id}
              currency={currency}
              storeSlug={store.slug}
              storeName={store.name}
              timezone={settings.timezone}
              maxDiscountPercent={theme.maxDiscountPercent}
            >
              <CartProvider>
                <AnalyticsProvider storeSlug={store.slug} channel="marketplace">
                  <ThemeWrapper mode={theme.mode} primaryColor={theme.primaryColor}>
                    <AdvisorProvider
                      storeSlug={store.slug}
                      enabled={advisorEnabled}
                      displayName={advisorSettings?.displayName}
                      welcomeMessage={advisorSettings?.welcomeMessage}
                    >
                      <MarketplaceStorefrontShell
                        storeName={store.name}
                        logoUrl={store.logoUrl}
                        marketplaceUrl={env.MARKETPLACE_URL}
                      >
                        {children}
                      </MarketplaceStorefrontShell>
                      {advisorEnabled && <AdvisorWidget />}
                    </AdvisorProvider>
                  </ThemeWrapper>
                </AnalyticsProvider>
              </CartProvider>
            </StoreProvider>
          </OpenReplayProvider>
        </PostHogProvider>
      </NextIntlClientProvider>
    );
  }

  return (
    <NextIntlClientProvider messages={messages}>
      <PostHogProvider>
        <OpenReplayProvider
          surface="storefront"
          store={{ id: store.id, name: store.name, slug: store.slug }}
        >
          <StoreProvider
            storeId={store.id}
            currency={currency}
            storeSlug={store.slug}
            storeName={store.name}
            timezone={settings.timezone}
            maxDiscountPercent={theme.maxDiscountPercent}
          >
            <CartProvider>
              <AnalyticsProvider storeSlug={store.slug}>
                <ThemeWrapper mode={theme.mode} primaryColor={theme.primaryColor}>
                  <AdvisorProvider
                    storeSlug={store.slug}
                    enabled={advisorEnabled}
                    displayName={advisorSettings?.displayName}
                    welcomeMessage={advisorSettings?.welcomeMessage}
                  >
                    <div className="flex min-h-screen flex-col bg-background">
                      <StoreHeaderWrapper
                        storeName={store.name}
                        storeSlug={store.slug}
                        logoUrl={store.logoUrl}
                      />
                      <main className="flex-1 pt-20 md:pt-24">{children}</main>
                      <StoreFooter
                        storeName={store.name}
                        storeSlug={store.slug}
                        email={store.email}
                        phone={store.phone}
                        address={store.address}
                      />
                    </div>
                    {advisorEnabled && <AdvisorWidget />}
                  </AdvisorProvider>
                </ThemeWrapper>
              </AnalyticsProvider>
            </CartProvider>
          </StoreProvider>
        </OpenReplayProvider>
      </PostHogProvider>
    </NextIntlClientProvider>
  );
};
