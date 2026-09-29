import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 6500,
  cues: [
    { at: 600, selector: '[data-product-open="demo-city-bike"]' },
    { at: 1400, selector: '[data-product-open="demo-city-bike"]', click: true },
    { at: 3000, selector: "[data-dashboard-content]" },
    { at: 3800, selector: "[data-dashboard-content]", scroll: { x: 0, y: 480, duration: 900 } },
  ],
};
