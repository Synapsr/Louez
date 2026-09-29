"use client";
import type { ReactNode } from "react";
import { StoreHeader } from "@/components/storefront/store-header";
import { HeaderSearchCapsuleView } from "@/components/storefront/shell/header-search-capsule-view";
import { CartTriggerView } from "@/components/storefront/cart/cart-trigger-view";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { DEMO_RULES } from "@/lib/landing-demos/fixtures";
import { getDemoCustomer } from "@/lib/landing-demos/reservations";
import { PORTAL_STORE } from "@/lib/landing-demos/portal";

/** The real storefront header; its unrelated controls stay inert in this account preview. */
export const PortalSceneFrame = ({
  children,
  period,
  signedIn = true,
  onBack,
}: {
  children: ReactNode;
  period: RentalPeriodValue;
  signedIn?: boolean;
  onBack?: () => void;
}) => (
  <div
    className="h-dvh overflow-y-auto bg-background"
    data-demo-target="portal-scroll"
    onClickCapture={(event) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest("a");
      if (!anchor) return;
      event.preventDefault();
      if (anchor.matches('[data-slot="back-link"]')) onBack?.();
    }}
  >
    <div inert>
      <StoreHeader
        storeName={PORTAL_STORE.storeName}
        homeHref="#"
        accountPrefetch={false}
        customerInitials={signedIn ? "CM" : null}
        customerIdentity={signedIn ? getDemoCustomer(0) : null}
        periodRules={DEMO_RULES}
        searchControl={
          <HeaderSearchCapsuleView
            rules={DEMO_RULES}
            query=""
            period={period}
            onQueryChange={() => {}}
            onClear={() => {}}
            onSubmit={() => {}}
            onPeriodChange={() => {}}
          />
        }
        cartControl={<CartTriggerView count={0} open={() => {}} />}
      />
    </div>
    {children}
  </div>
);
