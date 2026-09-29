import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 10000,
  cues: [
    { at: 700, selector: '[data-demo-target="customer-history"]' },
    { at: 2300, selector: "[data-dashboard-content]" },
    { at: 3100, selector: "[data-dashboard-content]", scroll: { x: 0, y: 360, duration: 1200 } },
    { at: 5000, selector: '[data-customer-reservation-status="completed"]' },
    { at: 5800, selector: '[data-customer-reservation-status="completed"]', click: true },
  ],
};
