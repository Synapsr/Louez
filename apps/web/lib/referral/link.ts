import { env } from '@/env';

/**
 * The shareable referral link a Referrer posts. Points at the marketing apex (e.g.
 * louez.io) — the best entry page — rather than the app, so the `.louez.io` cookie set by
 * the marketing/app middleware carries attribution all the way to onboarding on
 * app.louez.io. Uses http on localhost for dev.
 */
export function buildReferralUrl(referralCode: string): string {
  const domain = env.NEXT_PUBLIC_APP_DOMAIN; // "louez.io" or "localhost:3000"
  const isLocal = domain.includes('localhost') || domain.includes('127.0.0.1');
  const protocol = isLocal ? 'http' : 'https';
  return `${protocol}://${domain}/?ref=${referralCode}`;
}

/**
 * The domain the shared louez_referral cookie is scoped to (`.louez.io` in prod, undefined
 * on localhost). Must match what the middleware set it with, otherwise clearing it at
 * onboarding emits a non-matching expiry and the cookie lingers. Mirrors proxy.ts.
 */
export function referralCookieDomain(): string | undefined {
  const domain = env.NEXT_PUBLIC_APP_DOMAIN;
  if (domain.includes('localhost') || domain.includes('127.0.0.1')) {
    return undefined;
  }
  return `.${domain.split(':')[0]}`;
}
