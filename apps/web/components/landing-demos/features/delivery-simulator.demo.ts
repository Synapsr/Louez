import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

// The thumb's first child is its native range input (before the hydration script).
// The native setter + input event updates Base UI without pointer-down focus.
const distance = '[data-demo-target="delivery-distance"] [data-slot="slider-thumb"] > :first-child';
const orderTotal =
  '[data-demo-target="delivery-order-total"] [data-slot="slider-thumb"] > :first-child';

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 11800,
  cues: [
    { at: 700, selector: distance },
    { at: 1500, selector: distance, type: { text: "20", duration: 1 } },
    { at: 4000, selector: distance },
    { at: 4800, selector: distance, type: { text: "3", duration: 1 } },
    { at: 7300, selector: orderTotal },
    { at: 8100, selector: orderTotal, type: { text: "250", duration: 1 } },
  ],
};
