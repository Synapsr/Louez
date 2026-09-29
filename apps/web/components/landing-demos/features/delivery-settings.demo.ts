import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

const required =
  '[data-demo-target="delivery-mode"] [data-slot="radio-group"] > [data-slot="label"]:nth-child(2) [data-slot="radio"]';
const optional =
  '[data-demo-target="delivery-mode"] [data-slot="radio-group"] > [data-slot="label"]:nth-child(1) [data-slot="radio"]';
const price = '[data-demo-target="delivery-price-per-km"]';

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 9600,
  cues: [
    { at: 700, selector: required },
    { at: 1500, selector: required, click: true },
    { at: 3300, selector: optional },
    { at: 4100, selector: optional, click: true },
    { at: 5900, selector: price },
    { at: 6700, selector: price, type: { text: "2", duration: 600 } },
  ],
};
