/**
 * Pages that exist only for platform billing (louez-billing docs/plans/design.md §7.2):
 * plans and invoices, referrals, the per-store admin pricing and the platform finance
 * area. With LOUEZ_BILLING off the proxy answers 404 for them before any layout runs,
 * so an unsigned visitor gets the same answer as an owner, and each page also calls
 * `requirePlatformBilling()`. AI credits have their own switch (`areAiCreditsEnabled`),
 * which needs platform billing too.
 */
export const BILLING_ONLY_PATHS = [
  "/dashboard/subscription",
  "/dashboard/settings/subscription",
  "/dashboard/billing",
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

/**
 * Louez Cloud's terms of service, `app/(legal)/terms`, which bind only its customers
 * (design §7.2). Not in BILLING_ONLY_PATHS: on a storefront, and at the root of a
 * standalone instance with a store, `/terms` is the store's own terms and conditions.
 * The proxy answers 404 for it only where the Louez page would answer.
 */
export const LOUEZ_TERMS_PATH = "/terms";
