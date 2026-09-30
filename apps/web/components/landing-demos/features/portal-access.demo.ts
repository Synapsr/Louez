import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "customer",
  format: "phone",
  duration: 12000,
  cues: [
    { at: 300, selector: '[data-demo-target="portal-scroll"]' },
    {
      at: 1100,
      selector: '[data-demo-target="portal-scroll"]',
      scroll: { x: 0, y: 300, duration: 700 },
    },
    { at: 2400, selector: '[data-demo-target="portal-email-access"]' },
    { at: 3200, selector: '[data-demo-target="portal-email-access"]', emit: "portal-open-email" },
    { at: 4400, selector: '[data-demo-target="portal-scroll"]' },
    {
      at: 5200,
      selector: '[data-demo-target="portal-scroll"]',
      scroll: { x: 0, y: 530, duration: 900 },
    },
    { at: 7300, selector: '[data-demo-target="portal-scroll"]' },
    {
      at: 8100,
      selector: '[data-demo-target="portal-scroll"]',
      scroll: { x: 0, y: -530, duration: 900 },
    },
    { at: 9800, selector: '[data-demo-target="portal-contract"]' },
    { at: 10600, selector: '[data-demo-target="portal-contract"]', click: true },
  ],
};
