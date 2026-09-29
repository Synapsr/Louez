import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 11500,
  cues: [
    { at: 400, selector: "[data-dashboard-content]" },
    { at: 1200, selector: "[data-dashboard-content]", scroll: { x: 0, y: 480, duration: 1100 } },
    { at: 3000, selector: "[data-product-timeline-scroll]" },
    {
      at: 3800,
      selector: "[data-product-timeline-scroll]",
      scroll: { x: 230, y: 0, duration: 1100 },
    },
    { at: 5500, selector: '[data-demo-target="product-timeline-status-filter"]' },
    { at: 6300, selector: '[data-demo-target="product-timeline-status-filter"]', press: true },
    { at: 7100, selector: '[data-product-timeline-status="pending"]' },
    { at: 7900, selector: '[data-product-timeline-status="pending"]', click: true },
    { at: 9300, selector: '[data-demo-target="product-timeline-status-filter"]' },
    { at: 10100, selector: '[data-demo-target="product-timeline-status-filter"]', press: true },
  ],
};
