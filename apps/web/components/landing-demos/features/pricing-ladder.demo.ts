import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 10000,
  cues: [
    { at: 500, selector: '[data-demo-target="pricing-add-tier"]' },
    { at: 1300, selector: '[data-demo-target="pricing-add-tier"]', click: true },
    { at: 3200, selector: '[data-pricing-mode="prorated"]' },
    { at: 4000, selector: '[data-pricing-mode="prorated"]', click: true },
    { at: 5700, selector: '[data-demo-target="pricing-simulator"]' },
    { at: 6500, selector: '[data-demo-target="pricing-simulator"]', click: true },
  ],
};
