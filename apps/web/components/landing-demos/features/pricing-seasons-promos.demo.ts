import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 12000,
  cues: [
    { at: 400, selector: '[data-demo-target="pricing-period-selector"]' },
    { at: 1200, selector: '[data-demo-target="pricing-period-selector"]', click: true },
    { at: 2000, selector: '[data-pricing-period="demo-summer"]' },
    { at: 2800, selector: '[data-pricing-period="demo-summer"]', click: true },
    { at: 4500, selector: '[data-demo-target="pricing-editor"]' },
    { at: 5300, selector: '[data-demo-target="pricing-editor"]', emit: "pricing-show-promos" },
    { at: 6800, selector: '[data-demo-target="promo-create"]' },
    { at: 7600, selector: '[data-demo-target="promo-create"]', click: true },
    { at: 8200, selector: '[data-demo-target="promo-code-input"]' },
    {
      at: 9000,
      selector: '[data-demo-target="promo-code-input"]',
      type: { text: "VELO20", duration: 700 },
    },
  ],
};
