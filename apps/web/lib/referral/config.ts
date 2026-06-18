import { z } from 'zod';

/**
 * Tunable parameters of the Referral Program. All values are platform-level knobs
 * with safe launch defaults; the minimum qualifying amount is enforced from day one,
 * while the per-referrer monthly cap starts permissive (0 = unlimited) and can be
 * tightened later without a code change. Mirrors the pay-as-you-go config philosophy
 * (a shared Zod schema + a default+override resolver).
 */
export interface ReferralProgramConfig {
  /** Free reservations granted to the Referrer when a referral qualifies (PAYG referrer). */
  referrerRewardFreeReservations: number;
  /** Free reservations granted to the Referred Store at sign-up (always pay-as-you-go). */
  referredRewardFreeReservations: number;
  /** Minimum online payment (in cents) a Referred Store must take to unlock the Referrer Reward. */
  minQualifyingAmountCents: number;
  /** Max rewards a single Referrer can earn per calendar month. 0 = unlimited. */
  monthlyCapPerReferrer: number;
  /** Days after the grant during which a refunded/disputed qualifying payment claws the reward back. */
  clawbackWindowDays: number;
}

export const DEFAULT_REFERRAL_PROGRAM_CONFIG: ReferralProgramConfig = {
  referrerRewardFreeReservations: 30,
  referredRewardFreeReservations: 30,
  minQualifyingAmountCents: 2000, // 20 €
  monthlyCapPerReferrer: 0, // unlimited at launch
  clawbackWindowDays: 30,
};

/**
 * Partial config schema shared by the env transform and the platform-admin action, so
 * the same validation rules apply at every entry point. All fields optional; missing
 * fields fall back to {@link DEFAULT_REFERRAL_PROGRAM_CONFIG} via {@link resolveReferralProgramConfig}.
 */
export const referralProgramConfigSchema = z
  .object({
    referrerRewardFreeReservations: z.number().int().min(0).max(100_000),
    referredRewardFreeReservations: z.number().int().min(0).max(100_000),
    minQualifyingAmountCents: z.number().int().min(0).max(10_000_000),
    monthlyCapPerReferrer: z.number().int().min(0).max(100_000),
    clawbackWindowDays: z.number().int().min(0).max(3650),
  })
  .partial();

/** Fill any missing field with the platform default. Pure. */
export function resolveReferralProgramConfig(
  input?: Partial<ReferralProgramConfig> | null,
): ReferralProgramConfig {
  return { ...DEFAULT_REFERRAL_PROGRAM_CONFIG, ...(input ?? {}) };
}
