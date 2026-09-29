import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 10800,
  cues: [
    { at: 700, selector: '[data-demo-target="contract-parties"]' },
    { at: 2900, selector: '[data-demo-target="contract-equipment"]' },
    { at: 4500, selector: '[data-demo-target="contract-pages"]' },
    {
      at: 5300,
      selector: '[data-demo-target="contract-pages"]',
      scroll: { x: 0, y: 320, duration: 2100 },
    },
    { at: 8000, selector: '[data-demo-target="contract-totals"]' },
  ],
};
