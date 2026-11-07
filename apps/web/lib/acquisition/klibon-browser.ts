/**
 * The calls the Klibon tag (components/klibon-tag.tsx) exposes on `window`. Both are
 * safe without the tag: self-hosted instances and visitors who blocked it get null or
 * nothing, and the page goes on as before.
 */

declare global {
  interface Window {
    Klibon?: {
      referral?: () => string | null;
      signup?: (email: string) => void;
    };
  }
}

/** The affiliate code of the current visitor, read when a checkout starts; null for most. */
export function readAffiliateReferral(): string | null {
  try {
    return window.Klibon?.referral?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * Tells Klibon an account was created, so a later payment under this email is credited
 * to the affiliate who sent the visitor, from any device. Sends nothing for a visitor no
 * affiliate sent.
 */
export function reportAffiliateSignup(email: string): void {
  try {
    window.Klibon?.signup?.(email);
  } catch {
    // The tag never throws; a broken one must not break onboarding either.
  }
}
