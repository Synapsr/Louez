import { env } from "@/env";

/**
 * Paths the Stripe Connect flow may bounce back to after the hosted KYC,
 * instead of the default settings callback screen. Exact-match allowlist:
 * `next` round-trips through Stripe as a query param, so anything looser
 * would be an open redirect.
 */
const ALLOWED_NEXT_PATHS = ["/onboarding/source"];

export function sanitizeStripeNextPath(value: unknown): string | null {
  return typeof value === "string" && ALLOWED_NEXT_PATHS.includes(value) ? value : null;
}

export function stripeReturnUrls(next: string | null): {
  returnUrl: string;
  refreshUrl: string;
} {
  const suffix = next ? `?next=${encodeURIComponent(next)}` : "";
  return {
    returnUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard/settings/payments/callback${suffix}`,
    refreshUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard/settings/payments/refresh${suffix}`,
  };
}
