import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 10000,
  cues: [
    { at: 600, selector: '[data-demo-target="multi-store-totals"]' },
    { at: 2300, selector: '[data-demo-store="demo-store"]' },
    { at: 3400, selector: '[data-demo-store="demo-store-reze"]' },
    { at: 4500, selector: '[data-demo-store="demo-store-pornic"]' },
    { at: 6000, selector: '[data-demo-period="7d"]' },
    { at: 6800, selector: '[data-demo-period="7d"]', click: true },
    { at: 8200, selector: '[data-demo-target="multi-store-totals"]' },
  ],
};
