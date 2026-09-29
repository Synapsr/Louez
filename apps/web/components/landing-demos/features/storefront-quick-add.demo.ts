import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "customer",
  duration: 11500,
  cues: [
    { at: 500, selector: '[data-product-id="demo-city-bike"] [data-product-quick-add]' },
    {
      at: 1300,
      selector: '[data-product-id="demo-city-bike"] [data-product-quick-add]',
      click: true,
    },
    { at: 3200, selector: '[data-period-day-offset="3"][data-period-outside="false"]' },
    {
      at: 4000,
      selector: '[data-period-day-offset="3"][data-period-outside="false"]',
      click: true,
    },
    { at: 4800, selector: '[data-period-day-offset="5"][data-period-outside="false"]' },
    {
      at: 5600,
      selector: '[data-period-day-offset="5"][data-period-outside="false"]',
      click: true,
    },
    { at: 7000, selector: '[data-demo-target="period-apply"]' },
    { at: 7800, selector: '[data-demo-target="period-apply"]', click: true },
    { at: 9400, selector: '[data-slot="cart-totals"]' },
  ],
};
