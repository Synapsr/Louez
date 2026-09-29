import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 12000,
  cues: [
    { at: 300, selector: '[data-demo-target="reservation-preview-email"]' },
    { at: 1100, selector: '[data-demo-target="reservation-preview-email"]', click: true },
    { at: 2300, selector: '[data-demo-target="email-template-reminder_pickup"]' },
    { at: 3100, selector: '[data-demo-target="email-template-reminder_pickup"]', click: true },
    { at: 7100, selector: '[data-demo-target="email-template-reminder_pickup"]' },
    {
      at: 7900,
      selector: '[data-demo-target="email-template-reminder_pickup"]',
      emit: "customer-reminders-sms",
    },
    { at: 8800, selector: '[data-demo-target="customer-reminder-sms"]' },
  ],
};
