import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

const outbound = '[data-reservation-id="demo-delivery-outbound"]';
const returning = '[data-reservation-id="demo-delivery-return"]';

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 10000,
  cues: [
    { at: 700, selector: outbound },
    { at: 1500, selector: outbound, hover: true },
    { at: 5200, selector: returning },
    { at: 6000, selector: returning, hover: true },
  ],
};
