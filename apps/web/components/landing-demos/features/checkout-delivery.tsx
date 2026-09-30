"use client";

import { useMemo } from "react";
import { CheckoutFormView } from "@/app/(storefront)/[slug]/checkout/checkout-form-view";
import { CheckoutDeliveryStep } from "@/app/(storefront)/[slug]/checkout/components/checkout-delivery-step";
import { useCheckoutDelivery } from "@/app/(storefront)/[slug]/checkout/hooks/use-checkout-delivery";
import { checkoutFormOptions } from "@/app/(storefront)/[slug]/checkout/validator.checkout";
import { getCheckoutStepIds } from "@/app/(storefront)/[slug]/checkout/util.checkout-steps";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { CheckoutSceneFrame } from "@/components/landing-demos/features/checkout-scene-frame";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { useAppForm } from "@/hooks/form/form";
import {
  CHECKOUT_DEMO_ADDRESS_SOURCE,
  CHECKOUT_DEMO_DELIVERY,
  CHECKOUT_DEMO_STORE,
  getDemoCheckout,
  getDemoCheckoutSummary,
  resolveDemoCheckoutDistance,
} from "@/lib/landing-demos/checkout";

export const CheckoutDeliveryScene = ({ period }: FeatureSceneProps) => {
  const locale = useDemoLocale();
  const data = useMemo(() => getDemoCheckout(period, locale), [period, locale]);
  const form = useAppForm({ ...checkoutFormOptions, defaultValues: data.values });
  const delivery = useCheckoutDelivery({
    deliverySettings: CHECKOUT_DEMO_DELIVERY,
    storeLatitude: CHECKOUT_DEMO_STORE.latitude,
    storeLongitude: CHECKOUT_DEMO_STORE.longitude,
    subtotal: data.cart.summary.subtotal,
    resolveDistance: resolveDemoCheckoutDistance,
  });
  const summary = getDemoCheckoutSummary(
    data.cart,
    delivery.totalFee,
    delivery.outboundMethod === "address" || delivery.returnMethod === "address",
    delivery.canContinue,
  );

  return (
    <CheckoutSceneFrame period={period} count={data.cart.summary.count}>
      <StorefrontSection spacing="tight">
        <CheckoutFormView
          returnHref="#"
          steps={getCheckoutStepIds({ isDeliveryEnabled: true })}
          currentStep="delivery"
          summaryProps={summary}
        >
          <form.AppForm>
            <form.Form
              formName="checkout-delivery-demo"
              onSubmit={(event) => event.preventDefault()}
            >
              <CheckoutDeliveryStep
                form={form}
                deliverySettings={CHECKOUT_DEMO_DELIVERY}
                delivery={delivery}
                subtotal={data.cart.summary.subtotal}
                storeAddress={CHECKOUT_DEMO_STORE.address}
                storeName={CHECKOUT_DEMO_STORE.name}
                storeLatitude={CHECKOUT_DEMO_STORE.latitude}
                storeLongitude={CHECKOUT_DEMO_STORE.longitude}
                onUseCustomerAddress={() => {}}
                onBack={() => {}}
                onContinue={() => {}}
                stepDirection="forward"
                showMap={false}
                geolocationEnabled={false}
                addressSource={CHECKOUT_DEMO_ADDRESS_SOURCE}
                autoFocus={false}
              />
            </form.Form>
          </form.AppForm>
        </CheckoutFormView>
      </StorefrontSection>
    </CheckoutSceneFrame>
  );
};
