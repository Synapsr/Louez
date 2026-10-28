import { z } from "zod";

/**
 * `GET /dashboard/billing?to=<page>`: the hand-off to the billing service's pages
 * (louez-billing docs/api, README §10 steps 1 and 2). It answers a standalone page
 * with its own security headers, which the proxy leaves alone.
 */
export const BILLING_HANDOFF_PATH = "/dashboard/billing";

/** The settings page of the billing service: the offer, the card gate and the links. */
export const BILLING_SETTINGS_PATH = "/dashboard/settings/billing";

/** The onboarding step that sends a new store's owner to add a billing card. */
export const BILLING_CARD_STEP_PATH = "/onboarding/billing";

/**
 * Pages that exist only for platform billing (louez-billing docs/plans/design.md §7.2):
 * plans and invoices, referrals, the per-store admin pricing, the billing service's
 * hand-off, settings and onboarding step, and the platform finance area. With
 * LOUEZ_BILLING off the proxy answers 404 for them before any layout runs, so an
 * unsigned visitor gets the same answer as an owner, and each page also checks the mode
 * itself. AI credits have their own switch (`areAiCreditsEnabled`), which needs
 * platform billing too.
 */
export const BILLING_ONLY_PATHS = [
  "/dashboard/subscription",
  "/dashboard/settings/subscription",
  BILLING_HANDOFF_PATH,
  BILLING_SETTINGS_PATH,
  BILLING_CARD_STEP_PATH,
  "/dashboard/referrals",
  "/dashboard/settings/referrals",
  "/dashboard/ai-credits",
  "/dashboard/settings/admin",
  "/admin",
] as const;

/** The path itself or anything under it, never a sibling that shares a prefix. */
export function isBillingOnlyPath(pathname: string): boolean {
  return BILLING_ONLY_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** The hand-off route itself, with or without a trailing slash; not the return under it. */
export function isBillingHandoffPath(pathname: string): boolean {
  return pathname === BILLING_HANDOFF_PATH || pathname === `${BILLING_HANDOFF_PATH}/`;
}

/** The billing pages a hand-off may open: openapi `HandoffTokenClaims.to`. */
const handoffPage = z
  .string()
  .regex(/^\/(payment-method|statements(\/[A-Za-z0-9_-]{1,40})?|details)?$/);

/** `to` of the hand-off: the page asked for, or the overview `/` when absent or not one. */
export function readHandoffPage(value: string | null | undefined): string {
  const parsed = handoffPage.safeParse(value);
  return parsed.success ? parsed.data : "/";
}

/**
 * Where a hand-off left from, when "Back to Louez" goes back there rather than to the
 * billing settings: the onboarding's card step.
 */
export type BillingReturnOrigin = "onboarding";

/** The hand-off's query parameter that names its BillingReturnOrigin. */
export const BILLING_RETURN_ORIGIN_PARAM = "from";

export function readBillingReturnOrigin(
  value: string | null | undefined,
): BillingReturnOrigin | null {
  return value === "onboarding" ? "onboarding" : null;
}

/**
 * The dashboard link that opens `page` on the billing pages, through the hand-off, and
 * comes back to `origin` (the billing settings when null).
 */
export function billingHandoffHref(page = "/", origin: BillingReturnOrigin | null = null): string {
  const to = readHandoffPage(page);
  const query = new URLSearchParams();
  if (to !== "/") query.set("to", to);
  if (origin) query.set(BILLING_RETURN_ORIGIN_PARAM, origin);
  const search = query.toString();
  return search ? `${BILLING_HANDOFF_PATH}?${search}` : BILLING_HANDOFF_PATH;
}

/**
 * Louez Cloud's terms of service, `app/(legal)/terms`, which bind only its customers
 * (design §7.2). Not in BILLING_ONLY_PATHS: on a storefront, and at the root of a
 * standalone instance with a store, `/terms` is the store's own terms and conditions.
 * The proxy answers 404 for it only where the Louez page would answer.
 */
export const LOUEZ_TERMS_PATH = "/terms";
