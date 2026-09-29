import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "customer",
  duration: 12000,
  cues: [
    { at: 300, selector: '[data-demo-target="home-scroll"]' },
    {
      at: 1100,
      selector: '[data-demo-target="home-scroll"]',
      scroll: { x: 0, y: 1600, duration: 1700 },
    },
    { at: 3300, selector: '[data-demo-target="home-scroll"]' },
    {
      at: 4100,
      selector: '[data-demo-target="home-scroll"]',
      scroll: { x: 0, y: -1600, duration: 800 },
    },
    { at: 5200, selector: '[data-slot="home-period-search"] [data-period-field="end"]' },
    {
      at: 6000,
      selector: '[data-slot="home-period-search"] [data-period-field="end"]',
      click: true,
    },
    { at: 7000, selector: '[data-period-day-offset="1"][data-period-outside="false"]' },
    {
      at: 7800,
      selector: '[data-period-day-offset="1"][data-period-outside="false"]',
      click: true,
    },
    { at: 9000, selector: '[data-demo-target="period-apply"]' },
    { at: 9800, selector: '[data-demo-target="period-apply"]', click: true },
  ],
};
