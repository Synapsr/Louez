import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 10500,
  cues: [
    { at: 600, selector: "[data-dashboard-content]" },
    { at: 1400, selector: "[data-dashboard-content]", scroll: { x: 0, y: 380, duration: 1100 } },
    { at: 2800, selector: '[data-demo-target="analytics-occupancy"]' },
    { at: 4800, selector: "[data-dashboard-content]" },
    { at: 5600, selector: "[data-dashboard-content]", scroll: { x: 0, y: 370, duration: 1100 } },
    { at: 7000, selector: '[data-demo-target="analytics-top-products"]' },
  ],
};
