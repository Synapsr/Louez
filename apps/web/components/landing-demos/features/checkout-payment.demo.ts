import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "customer",
  duration: 11500,
  cues: [
    { at: 400, selector: '[data-demo-target="checkout-accept-terms"]' },
    { at: 1200, selector: '[data-demo-target="checkout-accept-terms"]', click: true },
    {
      at: 2400,
      selector:
        '[data-demo-target="checkout-order-summary"] [data-demo-target="checkout-deposit-help"]',
    },
    {
      at: 3200,
      selector:
        '[data-demo-target="checkout-order-summary"] [data-demo-target="checkout-deposit-help"]',
      hover: true,
    },
    { at: 4900, selector: '[data-demo-target="checkout-pay"]' },
    { at: 5700, selector: '[data-demo-target="checkout-pay"]', click: true },
    { at: 6900, selector: '[data-demo-target="checkout-scroll"]' },
    { at: 7700, selector: '[data-demo-target="checkout-scroll"]', emit: "checkout-payment-paid" },
    { at: 9000, selector: '[data-slot="reservation-outcome"]' },
  ],
};
