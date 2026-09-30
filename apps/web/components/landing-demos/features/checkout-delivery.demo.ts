import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "customer",
  duration: 10500,
  cues: [
    { at: 400, selector: '[data-checkout-leg="outbound"] [data-checkout-method="address"]' },
    {
      at: 1200,
      selector: '[data-checkout-leg="outbound"] [data-checkout-method="address"]',
      click: true,
    },
    { at: 2400, selector: '[data-address-input="fulfillment-outbound-address"]' },
    {
      at: 3200,
      selector: '[data-address-input="fulfillment-outbound-address"]',
      type: { text: "24 rue du Moulin", duration: 1500 },
    },
    { at: 5400, selector: '[data-address-suggestion="demo-checkout-carquefou"]' },
    { at: 6200, selector: '[data-address-suggestion="demo-checkout-carquefou"]', click: true },
    { at: 8100, selector: '[data-demo-target="checkout-order-summary"]' },
  ],
};
