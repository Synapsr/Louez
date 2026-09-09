"use client";

import type { ReactNode } from "react";

import { LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { CartTrigger } from "@/components/storefront/cart/cart-trigger";
import { HeaderAccountButton } from "@/components/storefront/shell/header-account-button";
import { HeaderSearchCapsule } from "@/components/storefront/shell/header-search-capsule";
import { StoreLogo } from "@/components/storefront/shell/store-logo";
import { useHeaderSearchVisible } from "@/components/storefront/shell/use-header-search-visible";
import { useChromeVariant } from "@/components/storefront/shell/use-chrome-variant";
import { useWindowScrolled } from "@/hooks/use-window-scrolled";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

interface StoreHeaderProps {
  storeName: string;
  logoUrl?: string | null;
  /** Initials of the signed-in customer, computed on the server. */
  customerInitials?: string | null;
  customerIdentity?: { firstName: string; lastName: string; email: string } | null;
  /** Store-relative home href; the marketplace keeps its channel param. */
  homeHref?: string;
  /** Sales-channel badge next to the logo (marketplace). */
  channelBadge?: ReactNode;
  /** Store rules the period picker validates against. */
  periodRules: RentalPeriodRules;
  showAccount?: boolean;
  showCart?: boolean;
}

/** Shared store navigation. */
export const StoreHeader = ({
  storeName,
  logoUrl,
  customerInitials,
  customerIdentity,
  homeHref = "/",
  channelBadge,
  periodRules,
  showAccount = true,
  showCart = true,
}: StoreHeaderProps) => {
  const t = useTranslations("storefront");
  const variant = useChromeVariant();
  const scrolled = useWindowScrolled();
  // The search starts out on the phone everywhere but the home, whose hero
  // already carries the period search.
  const mobileSearchVisible = useHeaderSearchVisible({ showAtTop: variant !== "transparent" });
  const showCapsule = variant !== "compact";

  return (
    <header
      data-slot="store-header"
      data-variant={variant}
      className={cn(
        "sticky top-0 z-40 border-b bg-background transition-colors duration-200",
        scrolled ? "border-border" : "border-transparent",
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-2 md:h-18 md:flex-nowrap md:gap-x-3",
            showCapsule ? "py-3 md:py-0" : "h-14 md:h-16",
          )}
        >
          <div className="order-1 flex h-11 min-w-0 items-center gap-2 md:h-auto">
            <StoreLogo
              storeName={storeName}
              logoUrl={logoUrl}
              href={homeHref}
              className="shrink-0"
            />
            {channelBadge ? <div className="hidden shrink-0 sm:block">{channelBadge}</div> : null}
          </div>

          {variant === "compact" ? (
            <div className="order-2 ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <LockIcon aria-hidden className="size-4" />
              <span className="hidden sm:inline">{t("header.secure")}</span>
            </div>
          ) : (
            <>
              {showCapsule ? (
                <div
                  className={cn(
                    "order-3 grid w-full transition-[grid-template-rows,opacity,visibility] duration-200 ease-out motion-reduce:transition-none md:visible md:absolute md:top-1/2 md:left-1/2 md:block md:max-w-sm md:-translate-x-1/2 md:-translate-y-1/2 md:opacity-100 lg:max-w-xl",
                    mobileSearchVisible
                      ? "visible grid-rows-[1fr] opacity-100"
                      : "invisible grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="min-h-0 overflow-hidden md:overflow-visible">
                    <div className="pt-2 md:pt-0">
                      <HeaderSearchCapsule rules={periodRules} className="w-full" />
                    </div>
                  </div>
                </div>
              ) : null}
              <nav
                aria-label={t("header.menu")}
                className="order-2 ml-auto flex items-center gap-1 md:order-3"
              >
                {showCart ? <CartTrigger /> : null}
                {showAccount ? (
                  <HeaderAccountButton initials={customerInitials} customer={customerIdentity} />
                ) : null}
              </nav>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
