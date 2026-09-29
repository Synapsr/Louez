import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 9500,
  cues: [
    { at: 500, selector: "[data-dashboard-content]" },
    { at: 1300, selector: "[data-dashboard-content]", scroll: { x: 0, y: 300, duration: 1100 } },
    {
      at: 2900,
      selector:
        '[data-demo-target="inspection-comparison-desktop"] [data-demo-photo="return-demo-inspection-photo-1-0"]',
    },
    {
      at: 3700,
      selector:
        '[data-demo-target="inspection-comparison-desktop"] [data-demo-photo="return-demo-inspection-photo-1-0"]',
      click: true,
    },
    { at: 6000, selector: '[data-demo-target="inspection-photo-close"]' },
    { at: 6800, selector: '[data-demo-target="inspection-photo-close"]', click: true },
    { at: 7600, selector: "[data-dashboard-content]" },
    { at: 8400, selector: "[data-dashboard-content]", scroll: { x: 0, y: -300, duration: 700 } },
  ],
};
