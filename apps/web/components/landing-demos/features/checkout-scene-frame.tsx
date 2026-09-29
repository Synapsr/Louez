"use client";

import type { ReactNode } from "react";
import { StoreHeader } from "@/components/storefront/store-header";
import { CartTriggerView } from "@/components/storefront/cart/cart-trigger-view";
import { HeaderSearchCapsuleView } from "@/components/storefront/shell/header-search-capsule-view";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { PeriodInteractionContext } from "@/components/storefront/date-picker/period-interaction-context";
import { CHECKOUT_DEMO_STORE } from "@/lib/landing-demos/checkout";
import { DEMO_RULES } from "@/lib/landing-demos/fixtures";
import { getDemoCustomer } from "@/lib/landing-demos/reservations";

export const CheckoutSceneFrame = ({
  period,
  count,
  children,
}: {
  period: RentalPeriodValue;
  count: number;
  children: ReactNode;
}) => (
  <div
    className="h-dvh overflow-y-auto bg-background"
    data-demo-target="checkout-scroll"
    onClickCapture={(event) => {
      if (event.target instanceof Element && event.target.closest("a")) event.preventDefault();
    }}
  >
    <PeriodInteractionContext.Provider value={{ autoFocus: false, modal: false }}>
      <div inert>
        <StoreHeader
          storeName={CHECKOUT_DEMO_STORE.name}
          homeHref="#"
          homePrefetch={false}
          accountPrefetch={false}
          customerInitials="CM"
          customerIdentity={getDemoCustomer(0)}
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
          cartControl={<CartTriggerView count={count} open={() => {}} />}
        />
      </div>
    </PeriodInteractionContext.Provider>
    {children}
  </div>
);
