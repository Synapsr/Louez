import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 10500,
  cues: [
    { at: 800, selector: '[data-demo-target="customers-search"]' },
    {
      at: 1600,
      selector: '[data-demo-target="customers-search"]',
      type: { text: "Camille", duration: 1600 },
    },
    { at: 4300, selector: '[data-customer-link="demo-customer-0"]' },
    { at: 5100, selector: '[data-customer-link="demo-customer-0"]', click: true },
    { at: 7300, selector: '[data-demo-target="customer-history"]' },
  ],
};
