import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  format: "phone",
  duration: 10000,
  cues: [
    { at: 400, selector: '[data-inspection-condition="ok"]' },
    { at: 1200, selector: '[data-inspection-condition="ok"]', click: true },
    { at: 2200, selector: '[data-demo-target="inspection-next"]' },
    { at: 3000, selector: '[data-demo-target="inspection-next"]', click: true },
    { at: 3800, selector: '[data-inspection-condition="wear"]' },
    { at: 4600, selector: '[data-inspection-condition="wear"]', click: true },
    { at: 5400, selector: '[data-demo-target="inspection-item-notes"]' },
    { at: 7300, selector: '[data-demo-target="inspection-next"]' },
    { at: 8100, selector: '[data-demo-target="inspection-next"]', click: true },
  ],
};
