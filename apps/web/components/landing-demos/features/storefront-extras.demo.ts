import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "customer",
  duration: 9500,
  cues: [
    { at: 500, selector: '[data-product-id="demo-city-bike"] [data-product-quick-add]' },
    {
      at: 1300,
      selector: '[data-product-id="demo-city-bike"] [data-product-quick-add]',
      click: true,
    },
    { at: 2800, selector: '[data-extra-id="demo-helmet"] [data-demo-target="extra-select"]' },
    {
      at: 3600,
      selector: '[data-extra-id="demo-helmet"] [data-demo-target="extra-select"]',
      click: true,
    },
    { at: 5100, selector: '[data-demo-target="extras-confirm"]' },
    { at: 5900, selector: '[data-demo-target="extras-confirm"]', click: true },
    { at: 7500, selector: '[data-slot="cart-totals"]' },
  ],
};
