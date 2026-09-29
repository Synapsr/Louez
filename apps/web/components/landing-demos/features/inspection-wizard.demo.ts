import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  format: "phone",
  duration: 11900,
  cues: [
    { at: 200, selector: '[data-demo-target="inspection-next"]' },
    { at: 1000, selector: '[data-demo-target="inspection-next"]', click: true },
    { at: 1300, selector: '[data-inspection-condition="wear"]' },
    { at: 2100, selector: '[data-inspection-condition="wear"]', click: true },
    { at: 2250, selector: '[data-demo-target="inspection-item-notes"]' },
    { at: 2600, selector: '[data-demo-target="inspection-next"]' },
    { at: 3400, selector: '[data-demo-target="inspection-next"]', click: true },
    { at: 3900, selector: '[data-demo-target="inspection-next"]' },
    { at: 4700, selector: '[data-demo-target="inspection-next"]', click: true },
    { at: 5400, selector: '[data-demo-target="inspection-next"]' },
    { at: 6200, selector: '[data-demo-target="inspection-next"]', click: true },
    { at: 6500, selector: '[data-demo-target="inspection-signature-canvas"]' },
    {
      at: 7300,
      selector: '[data-demo-target="inspection-signature-canvas"]',
      draw: { duration: 800 },
    },
    { at: 8300, selector: '[data-demo-target="inspection-signature-confirmation"]' },
    { at: 9100, selector: '[data-demo-target="inspection-signature-confirmation"]', click: true },
    { at: 9400, selector: '[data-demo-target="inspection-complete"]' },
    { at: 10200, selector: '[data-demo-target="inspection-complete"]', click: true },
    { at: 10500, selector: '[data-demo-target="inspection-result"]' },
  ],
};
