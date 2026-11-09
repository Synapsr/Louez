/**
 * Klibon, the affiliate network Louez Cloud pays its partners through
 * (https://klibon.com/docs/install). Its tag remembers which affiliate sent a visitor
 * and hands the page that affiliate's code; the code then rides on the plan Checkout,
 * where Klibon reads it back from Stripe.
 */

import { z } from "zod";

/**
 * The request header the dashboard's onboarding store step carries the affiliate code in
 * (lib/orpc/client.ts), read by the new-store port's signup attribution.
 */
export const AFFILIATE_REFERRAL_HEADER = "x-klibon-referral";

/** The shape Klibon gives its referral codes. */
const affiliateReferralSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/**
 * The affiliate code a browser sent, or undefined. The browser is not trusted: a value
 * without Klibon's shape is dropped, and the request goes on as for a visitor no
 * affiliate sent.
 */
export function parseAffiliateReferral(value: unknown): string | undefined {
  const parsed = affiliateReferralSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
