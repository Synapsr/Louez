import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 10000,
  cues: [
    { at: 700, selector: '[data-demo-target="download-contract"]' },
    { at: 1500, selector: '[data-demo-target="download-contract"]', click: true },
    { at: 2800, selector: '[data-demo-target="contract-parties"]' },
    { at: 4300, selector: '[data-demo-target="contract-pages"]' },
    {
      at: 5100,
      selector: '[data-demo-target="contract-pages"]',
      scroll: { x: 0, y: 420, duration: 2200 },
    },
    { at: 7700, selector: '[data-demo-target="contract-totals"]' },
  ],
};
