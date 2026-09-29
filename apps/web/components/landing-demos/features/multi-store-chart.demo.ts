import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 8000,
  cues: [
    { at: 700, selector: '[data-demo-store-toggle="1"]' },
    { at: 1500, selector: '[data-demo-store-toggle="1"]', click: true },
    { at: 3200, selector: '[data-demo-target="multi-store-chart"]' },
    { at: 5000, selector: '[data-demo-store-toggle="1"]' },
    { at: 5800, selector: '[data-demo-store-toggle="1"]', click: true },
  ],
};
