import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "customer",
  duration: 9000,
  cues: [
    { at: 1400, selector: '[data-demo-reservation="demo-reservation-0"]' },
    { at: 2200, selector: '[data-demo-reservation="demo-reservation-0"]', click: true },
    { at: 4300, selector: '[data-demo-target="portal-scroll"]' },
    {
      at: 5100,
      selector: '[data-demo-target="portal-scroll"]',
      scroll: { x: 0, y: 430, duration: 1100 },
    },
  ],
};
