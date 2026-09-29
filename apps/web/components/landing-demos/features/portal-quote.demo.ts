import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "customer",
  duration: 10000,
  cues: [
    { at: 900, selector: '[data-demo-target="portal-accept-quote"]' },
    { at: 1700, selector: '[data-demo-target="portal-accept-quote"]', click: true },
    { at: 3300, selector: '[data-demo-target="portal-confirm-action"]' },
    { at: 4100, selector: '[data-demo-target="portal-confirm-action"]', click: true },
    { at: 6200, selector: '[data-demo-target="portal-pay"]' },
  ],
};
