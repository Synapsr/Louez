import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 8500,
  cues: [
    {
      at: 700,
      selector:
        '[data-demo-target="inspection-mode"] [data-slot="label"]:nth-child(3) [data-slot="radio"]',
    },
    {
      at: 1500,
      selector:
        '[data-demo-target="inspection-mode"] [data-slot="label"]:nth-child(3) [data-slot="radio"]',
      click: true,
    },
    {
      at: 3500,
      selector: '[data-demo-target="inspection-signature-setting"] [data-slot="switch"]',
    },
    {
      at: 4300,
      selector: '[data-demo-target="inspection-signature-setting"] [data-slot="switch"]',
      click: true,
    },
    {
      at: 6000,
      selector: '[data-demo-target="inspection-signature-setting"] [data-slot="switch"]',
    },
    {
      at: 6800,
      selector: '[data-demo-target="inspection-signature-setting"] [data-slot="switch"]',
      click: true,
    },
  ],
};
