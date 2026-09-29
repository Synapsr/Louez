"use client";

import { useRef, useState } from "react";

import { toZonedTime } from "date-fns-tz";

import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { CartDrawerView } from "@/components/storefront/cart/cart-drawer-view";
import { CartEmptyState } from "@/components/storefront/cart/cart-empty-state";
import { CartPanelView } from "@/components/storefront/cart/cart-panel-view";
import { CartTriggerView } from "@/components/storefront/cart/cart-trigger-view";
import { PeriodInteractionContext } from "@/components/storefront/date-picker/period-interaction-context";
import { GoogleRatingPill } from "@/components/storefront/home/google-rating-pill";
import { HomeInventoryView } from "@/components/storefront/home/home-inventory-view";
import { HomePeriodSearchView } from "@/components/storefront/home/home-period-search-view";
import { StoreHero } from "@/components/storefront/home/store-hero";
import { StoreLocationView } from "@/components/storefront/home/store-location-view";
import { StoreReassurance } from "@/components/storefront/home/store-reassurance";
import { ProductGridView } from "@/components/storefront/product/product-grid-view";
import { AnnouncementBar } from "@/components/storefront/shell/announcement-bar";
import { HeaderSearchCapsuleView } from "@/components/storefront/shell/header-search-capsule-view";
import { StoreFooter } from "@/components/storefront/store-footer";
import { StoreHeader } from "@/components/storefront/store-header";
import { StoreStatusBadge } from "@/components/storefront/store-status-badge";
import { getDemoCart } from "@/lib/landing-demos/cart";
import { DEMO_RULES } from "@/lib/landing-demos/fixtures";
import { getDemoToday } from "@/lib/landing-demos/reservations";
import {
  getStorefrontHomeDemo,
  STOREFRONT_HOME_HOURS,
  STOREFRONT_HOME_THEME,
} from "@/lib/landing-demos/storefront-home";
import { buildStoreThemeStyle } from "@/lib/theme/util.store-theme";
import { getStoreStatus } from "@/lib/utils/util.store-status";

export const StorefrontHomeScene = ({ period: initialPeriod }: FeatureSceneProps) => {
  const locale = useDemoLocale();
  const shop = getStorefrontHomeDemo(locale);
  const [period, setPeriod] = useState(initialPeriod);
  const [query, setQuery] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inventoryRef = useRef<HTMLDivElement>(null);
  const cart = getDemoCart(quantities, period, locale);
  const products = shop.products.filter((product) =>
    product.name.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)),
  );
  const showInventory = () => {
    const scroll = scrollRef.current;
    const inventory = inventoryRef.current;
    if (!scroll || !inventory) return;
    scroll.scrollBy({
      top: inventory.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 80,
      behavior: "instant",
    });
  };

  return (
    <PeriodInteractionContext.Provider
      value={{
        autoFocus: false,
        modal: false,
        dateReference: toZonedTime(initialPeriod.start, DEMO_RULES.timezone),
      }}
    >
      <div
        ref={scrollRef}
        data-demo-scene="storefront-home"
        data-demo-target="home-scroll"
        data-dashboard-content
        className="light h-dvh overflow-y-auto bg-background text-foreground"
        onClickCapture={(event) => {
          if (event.target instanceof Element && event.target.closest("a")) event.preventDefault();
        }}
      >
        <style>{buildStoreThemeStyle(STOREFRONT_HOME_THEME)}</style>
        <AnnouncementBar announcement={shop.announcement} />
        <StoreHeader
          storeName={shop.name}
          logoUrl={shop.logoUrl}
          phone={shop.phone}
          homeHref="/demos/landing/storefront-home"
          homePrefetch={false}
          accountPrefetch={false}
          periodRules={DEMO_RULES}
          searchControl={
            <HeaderSearchCapsuleView
              rules={DEMO_RULES}
              className="w-full"
              query={query}
              period={period}
              onQueryChange={setQuery}
              onClear={() => setQuery("")}
              onSubmit={showInventory}
              onPeriodChange={setPeriod}
            />
          }
          cartControl={
            <CartTriggerView count={cart.summary.count} open={() => setCartOpen(true)} />
          }
        />
        <main className="pb-[env(safe-area-inset-bottom,0px)]">
          <StoreHero
            name={shop.name}
            tagline={shop.tagline}
            description={null}
            backgroundImages={shop.heroImages}
            shape="cover"
            align="center"
            verticalAlign="center"
            badges={
              <>
                <StoreStatusBadge
                  businessHours={STOREFRONT_HOME_HOURS}
                  timezone={DEMO_RULES.timezone}
                  initialStatus={getStoreStatus(
                    STOREFRONT_HOME_HOURS,
                    DEMO_RULES.timezone,
                    getDemoToday(initialPeriod),
                  )}
                  className="bg-background/90 backdrop-blur"
                />
                <GoogleRatingPill rating={shop.rating} reviewCount={shop.reviewCount} href={null} />
              </>
            }
            footer={
              <StoreReassurance
                items={shop.reassurance}
                tone="onPhoto"
                className="justify-center"
              />
            }
          >
            <HomePeriodSearchView
              rules={DEMO_RULES}
              value={period}
              onChange={setPeriod}
              onSubmit={(next) => {
                setPeriod(next);
                showInventory();
              }}
            />
          </StoreHero>
          <div ref={inventoryRef} data-demo-target="home-inventory">
            <HomeInventoryView kind="products" linkPrefetch={false}>
              <ProductGridView
                products={products}
                period={cart.period}
                getProductHref={() => "/demos/landing/storefront-home"}
                onQuickAdd={(product) => {
                  setQuantities((current) => ({
                    ...current,
                    [product.id]: (current[product.id] ?? 0) + 1,
                  }));
                  setCartOpen(true);
                }}
              />
            </HomeInventoryView>
          </div>
          <StoreLocationView
            address={shop.address}
            contact={{ phone: shop.phone, email: shop.email, sms: true, whatsapp: null }}
            autoFocus={false}
          />
        </main>
        <StoreFooter
          storeName={shop.name}
          address={shop.address}
          phone={shop.phone}
          email={shop.email}
          linkPrefetch={false}
          showLanguageSwitcher={false}
        />
        <CartDrawerView
          isOpen={cartOpen}
          setOpen={setCartOpen}
          close={() => setCartOpen(false)}
          summary={cart.summary}
          isEmpty={!cart.items.length}
          blockedReasonKey={null}
          checkoutDisabled
          autoFocus={false}
          modal={false}
          emptyState={<CartEmptyState closeOnly onNavigate={() => setCartOpen(false)} />}
        >
          <CartPanelView
            items={cart.items}
            period={cart.period}
            resolutionStatus="ready"
            onRemove={(id) => setQuantities((current) => ({ ...current, [id]: 0 }))}
            onQuantityChange={(id, quantity) =>
              setQuantities((current) => ({ ...current, [id]: quantity }))
            }
            onNavigate={(event) => event.preventDefault()}
            getProductHref={() => "/demos/landing/storefront-home"}
          />
        </CartDrawerView>
      </div>
    </PeriodInteractionContext.Provider>
  );
};
