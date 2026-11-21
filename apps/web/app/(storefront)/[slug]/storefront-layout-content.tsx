import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getMessages } from "next-intl/server";

import { MarketplaceChannelBadge } from "@/components/storefront/shell/marketplace-channel-badge";
import { ReservationGateOwnerBanner } from "@/components/storefront/shell/reservation-gate-owner-banner";
import {
  StorefrontProviders,
  type StorefrontShellVariant,
} from "@/components/storefront/shell/storefront-providers";
import { StorefrontShell } from "@/components/storefront/shell/storefront-shell";
import { TestModeBanner } from "@/components/storefront/shell/test-mode-banner";
import { env } from "@/env";
import { isAdvisorActiveForStore } from "@/lib/ai/advisor/eligibility";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { loadLouezCreditTarget } from "@/lib/storefront/louez-credit.queries";
import { DEFAULT_STORE_THEME, type StoreThemeInput } from "@/lib/theme/util.store-theme";
import { getStorefrontPathPrefix } from "@/lib/util.storefront-host";
import { getCustomerInitials } from "@/lib/utils/util.storefront-chrome";

import { getCustomerSession } from "./account/actions";

interface StorefrontLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

/**
 * Embed and marketplace are decided by the proxy alone: it strips any
 * caller-provided header and sets these from the route, query and cookie.
 */
const resolveShellVariant = (requestHeaders: Headers): StorefrontShellVariant => {
  if (requestHeaders.get("x-embed-mode") === "1") {
    return "bare";
  }

  return requestHeaders.get("x-sales-channel") === "marketplace" ? "marketplace" : "store";
};

export const StorefrontLayoutContent = async ({ children, params }: StorefrontLayoutProps) => {
  const { slug } = await params;

  // Shares the request's single store read with the layout metadata; the
  // layout already answered 404 for an unknown store, this guard only
  // narrows the type.
  const store = await getStoreBySlug(slug);

  if (!store) {
    notFound();
  }

  const requestHeaders = await headers();
  const variant = resolveShellVariant(requestHeaders);

  // The advisor is opt-in per store and needs the platform AI config; the
  // customer session only matters where the account button is shown; the footer
  // credit, wherever there is a footer.
  const [messages, basePath, advisorEnabled, customerSession, louezCredit] = await Promise.all([
    getMessages(),
    getStorefrontPathPrefix(store.slug),
    variant === "bare" ? Promise.resolve(false) : isAdvisorActiveForStore(store),
    variant === "store" ? getCustomerSession(store.slug) : Promise.resolve(null),
    variant === "bare" ? Promise.resolve(null) : loadLouezCreditTarget(store),
  ]);

  const theme: StoreThemeInput = store.theme ?? DEFAULT_STORE_THEME;
  const customerInitials = customerSession ? getCustomerInitials(customerSession.customer) : null;

  return (
    <StorefrontProviders
      store={store}
      variant={variant}
      basePath={basePath}
      messages={messages}
      advisorEnabled={advisorEnabled}
    >
      <StorefrontShell
        store={store}
        theme={theme}
        variant={variant}
        advisorEnabled={advisorEnabled}
        louezCredit={louezCredit}
        customerInitials={customerInitials}
        customerIdentity={
          customerSession
            ? {
                firstName: customerSession.customer.firstName,
                lastName: customerSession.customer.lastName,
                email: customerSession.customer.email,
              }
            : null
        }
        channelBadge={
          variant === "marketplace" ? (
            <MarketplaceChannelBadge marketplaceUrl={env.MARKETPLACE_URL} />
          ) : undefined
        }
        ownerNotice={
          // The card gate's owner-only line, and the test mode's; nothing outside service mode.
          variant === "store" ? (
            <Suspense fallback={null}>
              <TestModeBanner storeId={store.id} basePath={basePath} />
              <ReservationGateOwnerBanner storeId={store.id} />
            </Suspense>
          ) : undefined
        }
      >
        {children}
      </StorefrontShell>
    </StorefrontProviders>
  );
};
