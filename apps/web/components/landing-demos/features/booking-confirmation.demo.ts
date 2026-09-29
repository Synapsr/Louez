import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "customer",
  duration: 11200,
  cues: [
    { at: 500, selector: '[data-product-id="demo-city-bike"] [data-product-quick-add]' },
    {
      at: 1300,
      selector: '[data-product-id="demo-city-bike"] [data-product-quick-add]',
      click: true,
    },
    { at: 3800, selector: '[data-slot="cart-totals"]' },
    { at: 4600, selector: '[data-slot="cart-totals"]', emit: "booking-confirmation-email" },
    { at: 6000, selector: '[data-demo-target="booking-confirmation-email"]' },
  ],
};
