import { env } from "@/env";

/**
 * AI advisor cost accounting. Every commercial value (token prices, credit
 * cost basis) is read from env — nothing is hardcoded, so the repo never
 * reveals cost or margin. All amounts are integers in micro-units to avoid
 * floating-point drift.
 */

/** 1 credit = 1_000_000 micro-credits. */
export const CREDIT_MICRO = 1_000_000;
/** 1 USD = 1_000_000 micro-USD (used for frozen cost audit). */
export const USD_MICRO = 1_000_000;

/** Coerce a possibly-string env value to a non-negative number (0 when invalid). */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Real advisor-model token prices in USD per 1M tokens, from env. When a
 * dedicated cache-read price is not set, cached input is priced at the input
 * rate (conservative). Missing prices resolve to 0 → cost 0.
 */
export function getAdvisorTokenPricing(): {
  inputPerMTok: number;
  outputPerMTok: number;
  cachedInputPerMTok: number;
} {
  const cachedRaw = env.AI_ADVISOR_CACHED_INPUT_USD_PER_MTOK;
  const hasCached = cachedRaw != null && String(cachedRaw).trim() !== "";
  return {
    inputPerMTok: num(env.AI_ADVISOR_INPUT_USD_PER_MTOK),
    outputPerMTok: num(env.AI_ADVISOR_OUTPUT_USD_PER_MTOK),
    cachedInputPerMTok: hasCached ? num(cachedRaw) : num(env.AI_ADVISOR_INPUT_USD_PER_MTOK),
  };
}

/** USD cost that equals 1 credit (≈ typical conversation cost). 0/unset ⇒ metering off. */
export function getCreditCostBasisUsd(): number {
  return num(env.AI_CREDIT_COST_BASIS_USD);
}

export type AdvisorUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

/** Normalize a possibly-partial usage object from the AI SDK to safe integers. */
export function normalizeUsage(usage: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
}): AdvisorUsage {
  const int = (v: number | null | undefined) =>
    Number.isFinite(v) && (v as number) > 0 ? Math.trunc(v as number) : 0;
  return {
    inputTokens: int(usage.inputTokens),
    outputTokens: int(usage.outputTokens),
    cachedInputTokens: int(usage.cachedInputTokens),
  };
}

/**
 * Real cost of one model run, in micro-USD, from measured token usage.
 * Assumes `inputTokens` is the total prompt tokens and `cachedInputTokens` is
 * the cached subset (priced at the cache rate). Tunable via env once real usage
 * data is available.
 */
export function runCostMicroUsd(usage: AdvisorUsage): number {
  const p = getAdvisorTokenPricing();
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const usd =
    (uncachedInput * p.inputPerMTok) / 1_000_000 +
    (usage.cachedInputTokens * p.cachedInputPerMTok) / 1_000_000 +
    (usage.outputTokens * p.outputPerMTok) / 1_000_000;
  return Math.round(usd * USD_MICRO);
}

/** The phone backend is always OpenAI and has its own configured prices. */
export function phoneRunCostMicroUsd(usage: AdvisorUsage): number {
  const input = num(env.AI_PHONE_INPUT_USD_PER_MTOK);
  const cached =
    env.AI_PHONE_CACHED_INPUT_USD_PER_MTOK == null
      ? input
      : num(env.AI_PHONE_CACHED_INPUT_USD_PER_MTOK);
  return Math.round(
    Math.max(0, usage.inputTokens - usage.cachedInputTokens) * input +
      usage.cachedInputTokens * cached +
      usage.outputTokens * num(env.AI_PHONE_OUTPUT_USD_PER_MTOK),
  );
}

/**
 * Convert a micro-USD cost into micro-credits via the env cost basis.
 * creditsMicro = costUsd / basisUsd × 1e6 = costMicroUsd / basisUsd.
 * Returns 0 when the cost basis is not configured.
 */
export function costMicroUsdToCreditsMicro(costMicroUsd: number): number {
  const basisUsd = getCreditCostBasisUsd();
  if (basisUsd <= 0) return 0;
  return Math.round(costMicroUsd / basisUsd);
}

// ============================================================================
// AI phone receptionist — voice (audio) cost
// A phone call's cost is dominated by audio minutes (telephony + STT + TTS),
// not tokens. The blended per-minute audio price of the chosen voice stack is
// read from env (never hardcoded), metered per call ALONGSIDE the LLM tokens,
// and converted to credits with the same cost basis as the text advisor.
// ============================================================================

/** Blended audio cost of the voice stack, USD per minute (0 when unset). */
export function getVoiceAudioUsdPerMinute(): number {
  return num(env.AI_VOICE_AUDIO_USD_PER_MIN);
}

/** Real audio cost of `audioSeconds` of call time, in micro-USD. */
export function audioCostMicroUsd(audioSeconds: number): number {
  const perMinute = getVoiceAudioUsdPerMinute();
  if (perMinute <= 0 || audioSeconds <= 0) return 0;
  const usd = (audioSeconds / 60) * perMinute;
  return Math.round(usd * USD_MICRO);
}

// ============================================================================
// Flat voice tariff + number rental (what the store is BILLED). The real USD
// cost above keeps being frozen on every debit row regardless, so billed vs
// cost stays comparable per row.
// ============================================================================

/**
 * Flat voice tariff: credits billed per STARTED minute of call. 0/unset ⇒
 * usage-metered (USD-based) billing.
 */
export function getPhoneCreditsPerMinute(): number {
  return num(env.AI_PHONE_CREDITS_PER_MINUTE);
}

/**
 * Micro-credits billed for a call of `audioSeconds` under the flat tariff:
 * every started minute counts. 0 when flat billing is off or nothing to bill.
 */
export function flatCallBillMicro(audioSeconds: number): number {
  const perMinute = getPhoneCreditsPerMinute();
  if (perMinute <= 0 || audioSeconds <= 0) return 0;
  return Math.round(Math.ceil(audioSeconds / 60) * perMinute * CREDIT_MICRO);
}

/** Monthly rental of a provisioned number, in credits (0/unset ⇒ free). */
export function getNumberRentalCredits(): number {
  return num(env.AI_PHONE_NUMBER_RENTAL_CREDITS);
}

/** Real monthly provider cost of a provisioned number, in micro-USD. */
export function numberRentalCostMicroUsd(): number {
  return Math.round(num(env.AI_PHONE_NUMBER_COST_USD_PER_MONTH) * USD_MICRO);
}

// ============================================================================
// AI product image enhancement — flat per-image tariff. Same philosophy as the
// voice tariff: the store is billed a flat number of credits while the real
// provider cost keeps being frozen on the debit row for cost-vs-billed
// reporting. Both values live in env, never in the repo.
// ============================================================================

/** Flat credits billed per enhanced product image. Defaults to 2; 0 makes it free. */
export function getImageEnhanceCredits(): number {
  return num(env.AI_IMAGE_ENHANCE_CREDITS);
}

/** Micro-credits billed for ONE enhancement under the flat tariff. */
export function imageEnhanceBillMicro(): number {
  return Math.round(getImageEnhanceCredits() * CREDIT_MICRO);
}

/** Flat credits billed per standalone background removal. 0/unset ⇒ free. */
export function getImageBgRemovalCredits(): number {
  return num(env.AI_IMAGE_BG_REMOVAL_CREDITS);
}

/** Micro-credits billed for ONE standalone background removal. */
export function imageBgRemovalBillMicro(): number {
  return Math.round(getImageBgRemovalCredits() * CREDIT_MICRO);
}

export type ImageTokenUsage = {
  inputTokens: number;
  inputImageTokens: number;
  inputTextTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ImageEnhanceCostSource = "measured_usage" | "configured_flat" | "unavailable";

export type ImageEnhanceCost = {
  microUsd: number;
  source: ImageEnhanceCostSource;
};

/**
 * Real provider cost of ONE enhancement.
 *
 * Prefer measured GPT Image usage returned by the provider. The flat per-image
 * env value is only a fallback for providers or responses that omit usage.
 */
export function imageEnhanceCost(usage: ImageTokenUsage | null = null): ImageEnhanceCost {
  if (usage) {
    const usd =
      (usage.inputTextTokens * num(env.AI_IMAGE_TEXT_INPUT_USD_PER_MTOK)) / 1_000_000 +
      (usage.inputImageTokens * num(env.AI_IMAGE_INPUT_USD_PER_MTOK)) / 1_000_000 +
      (usage.outputTokens * num(env.AI_IMAGE_OUTPUT_USD_PER_MTOK)) / 1_000_000;
    const measuredMicroUsd = Math.round(usd * USD_MICRO);

    // Some image responses expose the usage object while leaving every token
    // counter at zero. Treat that as unavailable telemetry: otherwise its
    // apparent measured cost of $0 would incorrectly bypass the configured
    // per-image fallback.
    if (measuredMicroUsd > 0) {
      return {
        microUsd: measuredMicroUsd,
        source: "measured_usage",
      };
    }
  }

  const configuredUsd = num(env.AI_IMAGE_USD_PER_IMAGE);
  if (configuredUsd > 0) {
    return {
      microUsd: Math.round(configuredUsd * USD_MICRO),
      source: "configured_flat",
    };
  }

  return { microUsd: 0, source: "unavailable" };
}
