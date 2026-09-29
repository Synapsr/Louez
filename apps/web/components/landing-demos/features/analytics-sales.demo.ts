import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 10000,
  cues: [
    { at: 800, selector: '[data-analytics-period="7d"]' },
    { at: 1600, selector: '[data-analytics-period="7d"]', click: true },
    { at: 3400, selector: '[data-demo-target="analytics-revenue-chart"]' },
    { at: 4200, selector: '[data-demo-target="analytics-revenue-chart"]', hover: true },
    { at: 6200, selector: '[data-analytics-period="30d"]' },
    { at: 7000, selector: '[data-analytics-period="30d"]', click: true },
    { at: 8200, selector: '[data-demo-target="analytics-revenue-chart"]' },
    { at: 9000, selector: '[data-demo-target="analytics-revenue-chart"]', hover: true },
  ],
};
