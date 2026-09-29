"use client";

import { useMemo, useRef, useState } from "react";
import { StorefrontScene } from "@/components/landing-demos/storefront-scene";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { CartDrawerView } from "@/components/storefront/cart/cart-drawer-view";
import { CartPanelView } from "@/components/storefront/cart/cart-panel-view";
import { CartTriggerView } from "@/components/storefront/cart/cart-trigger-view";
import { CartEmptyState } from "@/components/storefront/cart/cart-empty-state";
import { PeriodEditor } from "@/components/storefront/date-picker/period-editor";
import { PeriodInteractionContext } from "@/components/storefront/date-picker/period-interaction-context";
import { QuickAddDialogView } from "@/components/storefront/product/quick-add-dialog-view";
import { QuickAddExtrasStepView } from "@/components/storefront/product/quick-add-extras-step-view";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { DEMO_RULES } from "@/lib/landing-demos/fixtures";
import {
  getDemoProductCalendar,
  getDemoProductCatalog,
  getDemoProductCart,
  getDemoProductPage,
} from "@/lib/landing-demos/product-page";
import { StorefrontProductPage } from "./storefront-product-page";

type ProductDemoVariant = "product" | "pricing" | "quick-add" | "extras";

export const StorefrontProductDemo = ({
  period: initialPeriod,
  variant,
}: {
  period: RentalPeriodValue;
  variant: ProductDemoVariant;
}) => {
  const locale = useDemoLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState(initialPeriod);
  const [productId, setProductId] = useState("demo-city-bike");
  const [showProduct, setShowProduct] = useState(variant === "pricing");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [step, setStep] = useState<"period" | "extras" | null>(null);
  const calendar = useMemo(() => getDemoProductCalendar(initialPeriod), [initialPeriod]);
  const interaction = useMemo(
    () => ({ autoFocus: false, modal: false, dateReference: calendar.reference }),
    [calendar],
  );
  const { catalogProduct } = getDemoProductPage(locale, productId, variant === "extras");
  const cart = getDemoProductCart(quantities, period, locale);
  const products = useMemo(
    () => getDemoProductCatalog(locale, variant === "extras"),
    [locale, variant],
  );
  const add = (id: string, quantity = 1) =>
    setQuantities((current) => ({ ...current, [id]: (current[id] ?? 0) + quantity }));
  const finish = () => {
    setStep(null);
    setCartOpen(true);
  };
  const quickAdd = (id: string) => {
    setProductId(id);
    if (variant === "quick-add") {
      setStep("period");
      return;
    }
    add(id);
    if (variant === "extras") setStep("extras");
    else setCartOpen(true);
  };
  const openProduct = (id: string) => {
    setProductId(id);
    setShowProduct(true);
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const changeQuantity = (id: string, quantity: number) =>
    setQuantities((current) => ({ ...current, [id]: quantity }));

  return (
    <PeriodInteractionContext.Provider value={interaction}>
      <div
        ref={scrollRef}
        data-demo-target="storefront-product-flow"
        className="h-dvh overflow-y-auto"
      >
        {showProduct ? (
          <StorefrontProductPage
            key={productId}
            productId={productId}
            period={period}
            onPeriodChange={setPeriod}
            cartCount={cart.summary.count}
            onOpenCart={() => setCartOpen(true)}
            onReserve={(quantity) => {
              add(productId, quantity);
              if (variant === "extras") setStep("extras");
              else setCartOpen(true);
            }}
            onQuickAdd={quickAdd}
            onCatalog={() => {
              setShowProduct(false);
              scrollRef.current?.scrollTo({ top: 0 });
            }}
            onOpenProduct={openProduct}
          />
        ) : (
          <StorefrontScene
            key={`${period.start.toISOString()}:${period.end.toISOString()}`}
            onPeriodChange={setPeriod}
            products={products}
            compact={false}
            period={period}
            onBookingChange={() => {}}
            onOpenProduct={openProduct}
            onQuickAdd={quickAdd}
            cartControl={
              <CartTriggerView count={cart.summary.count} open={() => setCartOpen(true)} />
            }
          />
        )}
        <QuickAddDialogView
          isOpen={step !== null}
          step={step ?? undefined}
          steps={step === "extras" ? ["extras"] : ["period"]}
          productName={catalogProduct.name}
          onDismiss={step === "extras" ? finish : () => setStep(null)}
          autoFocus={false}
          modal={false}
        >
          {step === "period" ? (
            <PeriodEditor
              value={null}
              rules={DEMO_RULES}
              productId={productId}
              suppliedAvailability={calendar}
              minDate={calendar.reference}
              variant="sheet"
              months={2}
              onApply={(next) => {
                setPeriod(next);
                add(productId);
                finish();
              }}
            />
          ) : null}
          {step === "extras" ? (
            <QuickAddExtrasStepView
              product={catalogProduct}
              period={cart.period}
              onDone={finish}
              cartProductIds={new Set(cart.items.map((item) => item.productId))}
              onAddExtras={(extras) =>
                setQuantities((current) => ({
                  ...current,
                  ...Object.fromEntries(
                    extras.map((extra) => [extra.id, (current[extra.id] ?? 0) + 1]),
                  ),
                }))
              }
            />
          ) : null}
        </QuickAddDialogView>
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
            onRemove={(id) => changeQuantity(id, 0)}
            onQuantityChange={changeQuantity}
            onNavigate={(event) => event.preventDefault()}
            getProductHref={() => "/demos/landing/storefront-product"}
          />
        </CartDrawerView>
      </div>
    </PeriodInteractionContext.Provider>
  );
};
