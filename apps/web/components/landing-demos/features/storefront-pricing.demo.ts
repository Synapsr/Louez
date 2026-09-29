import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "customer",
  duration: 11500,
  cues: [
    { at: 600, selector: '[data-demo-target="product-period"] [data-period-field="end"]' },
    {
      at: 1400,
      selector: '[data-demo-target="product-period"] [data-period-field="end"]',
      click: true,
    },
    { at: 2600, selector: '[data-period-day-offset="6"][data-period-outside="false"]' },
    {
      at: 3400,
      selector: '[data-period-day-offset="6"][data-period-outside="false"]',
      click: true,
    },
    { at: 4500, selector: '[data-demo-target="period-apply"]' },
    { at: 5300, selector: '[data-demo-target="period-apply"]', click: true },
    { at: 6500, selector: '[data-demo-target="storefront-product-flow"]' },
    {
      at: 7300,
      selector: '[data-demo-target="storefront-product-flow"]',
      scroll: { x: 0, y: 430, duration: 1000 },
    },
    { at: 9000, selector: '[data-demo-target="product-rates"]' },
  ],
};
