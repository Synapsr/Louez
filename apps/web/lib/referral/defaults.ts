import { env } from '@/env';

import {
  type ReferralProgramConfig,
  resolveReferralProgramConfig,
} from './config';

/**
 * Defensive int coercion: under SKIP_ENV_VALIDATION the env transforms don't run and
 * `env.X` is a raw string, so mirror the pay-as-you-go defaults pattern and coerce here.
 */
function coerceInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
}

/**
 * The platform Referral Program configuration, resolved from env with defensive coercion.
 * Server-only — reads `env`; do not import into client components.
 */
export function getReferralProgramConfig(): ReferralProgramConfig {
  return resolveReferralProgramConfig({
    referrerRewardFreeReservations: coerceInt(env.REFERRAL_REFERRER_REWARD, 30),
    referredRewardFreeReservations: coerceInt(env.REFERRAL_REFERRED_REWARD, 30),
    minQualifyingAmountCents: coerceInt(env.REFERRAL_MIN_QUALIFYING_CENTS, 2000),
    monthlyCapPerReferrer: coerceInt(env.REFERRAL_MONTHLY_CAP, 0),
    clawbackWindowDays: coerceInt(env.REFERRAL_CLAWBACK_DAYS, 30),
  });
}
