import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "customer",
  duration: 12000,
  cues: [
    { at: 200, selector: '[data-demo-target="storefront-product-flow"]' },
    {
      at: 1000,
      selector: '[data-demo-target="storefront-product-flow"]',
      scroll: { x: 0, y: 120, duration: 500 },
    },
    { at: 1700, selector: '[data-product-id="demo-city-bike"] [data-demo-target="product-link"]' },
    {
      at: 2500,
      selector: '[data-product-id="demo-city-bike"] [data-demo-target="product-link"]',
      click: true,
    },
    { at: 3700, selector: '[data-demo-target="product-period"] [data-period-field="end"]' },
    {
      at: 4500,
      selector: '[data-demo-target="product-period"] [data-period-field="end"]',
      click: true,
    },
    { at: 5200, selector: '[data-period-day-offset="2"][data-period-outside="false"]' },
    {
      at: 6000,
      selector: '[data-period-day-offset="2"][data-period-outside="false"]',
      click: true,
    },
    { at: 6700, selector: '[data-demo-target="period-apply"]' },
    { at: 7500, selector: '[data-demo-target="period-apply"]', click: true },
    { at: 8800, selector: '[data-demo-target="product-reserve"]' },
    { at: 9600, selector: '[data-demo-target="product-reserve"]', click: true },
  ],
};
