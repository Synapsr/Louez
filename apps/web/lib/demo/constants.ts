/**
 * Demo stores, shared constants (docs/demo-par-metier.md). Safe for the client.
 */

/** How long a visitor's demo store lives before the cron deletes it. */
export const DEMO_STORE_TTL_HOURS = 24;

/** The visitor's demo: the trade, its store and an id for analytics. httpOnly. */
export const DEMO_COOKIE = "louez_demo";

/** Demo stores one address may open per hour. */
export const DEMO_STARTS_PER_IP_PER_HOUR = 6;

/** Demo stores the instance keeps at once; past it, a visitor waits for the cleanup. */
export const DEMO_STORES_MAX_ACTIVE = 2000;

/** Owners of demo stores: `visiteur-<id>@demo.example`, a reserved domain (RFC 2606). */
export const DEMO_OWNER_EMAIL_PREFIX = "visiteur-";
export const DEMO_OWNER_EMAIL_DOMAIN = "demo.example";

export const isDemoOwnerEmail = (email: string | null | undefined): boolean =>
  Boolean(
    email &&
    email.startsWith(DEMO_OWNER_EMAIL_PREFIX) &&
    email.endsWith(`@${DEMO_OWNER_EMAIL_DOMAIN}`),
  );

/** The message key of a refusal on a demo store (an invitation, a payout, a top-up…). */
export const DEMO_ACTION_DISABLED_ERROR = "errors.demoStoreActionDisabled";

/** The steps the guide and the demo store report. */
export const DEMO_STEPS = [
  "storefront_opened",
  "booking_created",
  "booking_opened",
  "check_in_opened",
  "deposit_opened",
  "guide_step_clicked",
] as const;
export type DemoStep = (typeof DEMO_STEPS)[number];
