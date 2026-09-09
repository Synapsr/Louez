import type { ReactNode } from "react";

import { cn } from "@louez/utils";

import { AdvisorWidget } from "@/components/storefront/advisor/advisor-widget";
import { CartDrawer } from "@/components/storefront/cart/cart-drawer";
import type { StorefrontShellVariant } from "@/components/storefront/shell/storefront-providers";
import { StoreFooter } from "@/components/storefront/store-footer";
import { StoreHeader } from "@/components/storefront/store-header";
import type { StorefrontStore } from "@/lib/storefront/get-store-by-slug";
import {
  buildStoreThemeStyle,
  getStoreThemeClassName,
  type StoreThemeInput,
} from "@/lib/theme/util.store-theme";
import { getStorePeriodRules } from "@/lib/utils/util.store-period-rules";

interface StorefrontShellProps {
  store: StorefrontStore;
  theme: StoreThemeInput;
  variant: StorefrontShellVariant;
  advisorEnabled: boolean;
  customerInitials?: string | null;
  customerIdentity?: { firstName: string; lastName: string; email: string } | null;
  /** Sales-channel badge for the marketplace header. */
  channelBadge?: ReactNode;
  children: ReactNode;
}

/**
 * Page chrome around every storefront route. The tenant colours are
 * rendered on the server as an inline `<style>` and the `dark` class is set
 * on this wrapper and, before first paint, on `<html>` so portals (sheets,
 * dialogs) pick the same tokens. `bare` (embed) drops header, footer and
 * background so the host page shows through the iframe.
 */
export const StorefrontShell = ({
  store,
  theme,
  variant,
  advisorEnabled,
  customerInitials,
  customerIdentity,
  channelBadge,
  children,
}: StorefrontShellProps) => {
  const isDark = theme.mode === "dark";
  const themeStyle = buildStoreThemeStyle(theme);
  const themeHead = (
    <>
      {themeStyle ? <style>{themeStyle}</style> : null}
      <script>{`document.documentElement.classList.toggle("dark",${isDark})`}</script>
    </>
  );

  if (variant === "bare") {
    return (
      <div className={cn("text-foreground", getStoreThemeClassName(theme.mode))}>
        {themeHead}
        <style>{"html,body{background:transparent!important}"}</style>
        {children}
      </div>
    );
  }

  const isMarketplace = variant === "marketplace";
  const logoUrl = isDark && store.darkLogoUrl ? store.darkLogoUrl : store.logoUrl;
  const periodRules = getStorePeriodRules(store.settings);

  return (
    <div
      className={cn(
        "flex min-h-dvh flex-col bg-background text-foreground",
        getStoreThemeClassName(theme.mode),
      )}
    >
      {themeHead}
      <StoreHeader
        storeName={store.name}
        logoUrl={logoUrl}
        customerInitials={customerInitials}
        customerIdentity={customerIdentity}
        homeHref={isMarketplace ? "/?channel=marketplace" : "/"}
        channelBadge={channelBadge}
        periodRules={periodRules}
        showAccount={!isMarketplace}
      />
      <main className="flex-1 pb-[env(safe-area-inset-bottom,0px)]">{children}</main>
      <StoreFooter
        storeName={store.name}
        email={store.email}
        phone={store.phone}
        address={store.address}
        showAccount={!isMarketplace}
      />
      <CartDrawer />
      {advisorEnabled ? <AdvisorWidget /> : null}
    </div>
  );
};
