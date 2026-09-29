import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 8500,
  cues: [
    { at: 600, selector: '[data-demo-target="team-invite-email"]' },
    {
      at: 1400,
      selector: '[data-demo-target="team-invite-email"]',
      type: { text: "lea.dupont@example.com", duration: 1600 },
    },
    { at: 3600, selector: '[data-demo-target="team-invite-submit"]' },
    { at: 4400, selector: '[data-demo-target="team-invite-submit"]', click: true },
    { at: 6000, selector: '[data-demo-target="team-pending-invitation"]' },
  ],
};
