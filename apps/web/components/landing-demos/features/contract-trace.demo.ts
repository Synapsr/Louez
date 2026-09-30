import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 11000,
  cues: [
    { at: 700, selector: '[data-demo-target="contract-validation"]' },
    { at: 3900, selector: '[data-demo-target="contract-back"]' },
    { at: 4700, selector: '[data-demo-target="contract-back"]', click: true },
    { at: 6400, selector: "[data-reservation-history] button" },
    { at: 7200, selector: "[data-reservation-history] button", click: true },
    { at: 8600, selector: "[data-reservation-history]" },
  ],
};
