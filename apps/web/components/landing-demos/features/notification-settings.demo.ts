import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 11200,
  cues: [
    { at: 500, selector: '[data-demo-target="customer-notifications"]' },
    { at: 2000, selector: '[data-demo-target="customer_reminder_pickup-sms"]' },
    { at: 2800, selector: '[data-demo-target="customer_reminder_pickup-sms"]', click: true },
    { at: 4400, selector: '[data-demo-target="customer_reminder_pickup-template"]' },
    { at: 5200, selector: '[data-demo-target="customer_reminder_pickup-template"]', click: true },
    { at: 6800, selector: '[data-demo-target="notification-template-sms"]' },
    { at: 7600, selector: '[data-demo-target="notification-template-sms"]', click: true },
  ],
};
