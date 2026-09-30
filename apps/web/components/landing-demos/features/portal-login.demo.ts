import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "customer",
  duration: 11000,
  cues: [
    { at: 300, selector: '[data-demo-target="portal-email"] [data-slot="input"]' },
    {
      at: 1100,
      selector: '[data-demo-target="portal-email"] [data-slot="input"]',
      type: { text: "camille.martin@example.com", duration: 1300 },
    },
    { at: 2800, selector: '[data-demo-target="portal-send-code"]' },
    { at: 3600, selector: '[data-demo-target="portal-send-code"]', click: true },
    { at: 4500, selector: '[data-demo-target="portal-code"] [data-input-otp]' },
    {
      at: 5300,
      selector: '[data-demo-target="portal-code"] [data-input-otp]',
      type: { text: "482916", duration: 1200 },
    },
    { at: 7800, selector: '[data-demo-reservation="demo-reservation-0"]' },
  ],
};
