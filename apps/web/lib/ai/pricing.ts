import { env } from '@/env'

/**
 * AI advisor cost accounting. Every commercial value (token prices, credit
 * cost basis) is read from env — nothing is hardcoded, so the repo never
 * reveals cost or margin. All amounts are integers in micro-units to avoid
 * floating-point drift.
 */

/** 1 credit = 1_000_000 micro-credits. */
export const CREDIT_MICRO = 1_000_000
/** 1 USD = 1_000_000 micro-USD (used for frozen cost audit). */
export const USD_MICRO = 1_000_000

/** Coerce a possibly-string env value to a non-negative number (0 when invalid). */
function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Real advisor-model token prices in USD per 1M tokens, from env. When a
 * dedicated cache-read price is not set, cached input is priced at the input
 * rate (conservative). Missing prices resolve to 0 → cost 0.
 */
export function getAdvisorTokenPricing(): {
  inputPerMTok: number
  outputPerMTok: number
  cachedInputPerMTok: number
} {
  const cachedRaw = env.AI_ADVISOR_CACHED_INPUT_USD_PER_MTOK
  const hasCached = cachedRaw != null && String(cachedRaw).trim() !== ''
  return {
    inputPerMTok: num(env.AI_ADVISOR_INPUT_USD_PER_MTOK),
    outputPerMTok: num(env.AI_ADVISOR_OUTPUT_USD_PER_MTOK),
    cachedInputPerMTok: hasCached
      ? num(cachedRaw)
      : num(env.AI_ADVISOR_INPUT_USD_PER_MTOK),
  }
}

/** USD cost that equals 1 credit (≈ typical conversation cost). 0/unset ⇒ metering off. */
export function getCreditCostBasisUsd(): number {
  return num(env.AI_CREDIT_COST_BASIS_USD)
}

export type AdvisorUsage = {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
}

/** Normalize a possibly-partial usage object from the AI SDK to safe integers. */
export function normalizeUsage(usage: {
  inputTokens?: number | null
  outputTokens?: number | null
  cachedInputTokens?: number | null
}): AdvisorUsage {
  const int = (v: number | null | undefined) =>
    Number.isFinite(v) && (v as number) > 0 ? Math.trunc(v as number) : 0
  return {
    inputTokens: int(usage.inputTokens),
    outputTokens: int(usage.outputTokens),
    cachedInputTokens: int(usage.cachedInputTokens),
  }
}

/**
 * Real cost of one model run, in micro-USD, from measured token usage.
 * Assumes `inputTokens` is the total prompt tokens and `cachedInputTokens` is
 * the cached subset (priced at the cache rate). Tunable via env once real usage
 * data is available.
 */
export function runCostMicroUsd(usage: AdvisorUsage): number {
  const p = getAdvisorTokenPricing()
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens)
  const usd =
    (uncachedInput * p.inputPerMTok) / 1_000_000 +
    (usage.cachedInputTokens * p.cachedInputPerMTok) / 1_000_000 +
    (usage.outputTokens * p.outputPerMTok) / 1_000_000
  return Math.round(usd * USD_MICRO)
}

/**
 * Convert a micro-USD cost into micro-credits via the env cost basis.
 * creditsMicro = costUsd / basisUsd × 1e6 = costMicroUsd / basisUsd.
 * Returns 0 when the cost basis is not configured.
 */
export function costMicroUsdToCreditsMicro(costMicroUsd: number): number {
  const basisUsd = getCreditCostBasisUsd()
  if (basisUsd <= 0) return 0
  return Math.round(costMicroUsd / basisUsd)
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
  return num(env.AI_VOICE_AUDIO_USD_PER_MIN)
}

/** Real audio cost of `audioSeconds` of call time, in micro-USD. */
export function audioCostMicroUsd(audioSeconds: number): number {
  const perMinute = getVoiceAudioUsdPerMinute()
  if (perMinute <= 0 || audioSeconds <= 0) return 0
  const usd = (audioSeconds / 60) * perMinute
  return Math.round(usd * USD_MICRO)
}
