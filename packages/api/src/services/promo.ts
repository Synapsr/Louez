import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@louez/db";
import { promoCodes } from "@louez/db/schema";
import type { PromoCodeSnapshot } from "@louez/types";
import type { StorefrontPromoValidateOutput } from "@louez/validations";

import {
  loadPricingCatalog,
  priceCatalogLine,
  type PricingCatalogLineInput,
} from "./pricing-catalog";

/** The promo row fields the evaluation needs (a subset of `promoCodes`). */
export interface PromoCodeEvaluationRow {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: string;
  minimumAmount: string | null;
  maxUsageCount: number | null;
  currentUsageCount: number;
  startsAt: Date | null;
  expiresAt: Date | null;
}

export type PromoCodeEvaluation =
  | {
      ok: true;
      promoCodeId: string;
      discountAmount: number;
      minimumAmount: number;
      snapshot: PromoCodeSnapshot;
    }
  | {
      ok: false;
      error:
        | "errors.promoCodeInvalid"
        | "errors.promoCodeNotStarted"
        | "errors.promoCodeExpired"
        | "errors.promoCodeExhausted"
        | "errors.promoCodeMinimumNotMet";
      params?: { amount: string };
    };

/** Percentage or fixed discount, capped at the subtotal, rounded to the cent. */
export const calculatePromoDiscount = (
  promo: Pick<PromoCodeEvaluationRow, "type" | "value">,
  subtotal: number,
): number => {
  const promoValue = parseFloat(promo.value);
  const raw =
    promo.type === "percentage"
      ? Math.min((subtotal * promoValue) / 100, subtotal)
      : Math.min(promoValue, subtotal);
  return Math.round(raw * 100) / 100;
};

/**
 * Pure promo evaluation: active row (or null), dates, usage cap and minimum
 * on the subtotal (insurance excluded). Consumption is a separate guarded
 * write so the cap is enforced atomically inside the reservation transaction.
 */
export const evaluatePromoCode = ({
  promo,
  subtotal,
  now = new Date(),
}: {
  promo: PromoCodeEvaluationRow | null | undefined;
  subtotal: number;
  now?: Date;
}): PromoCodeEvaluation => {
  if (!promo) {
    return { ok: false, error: "errors.promoCodeInvalid" };
  }
  if (promo.startsAt && promo.startsAt > now) {
    return { ok: false, error: "errors.promoCodeNotStarted" };
  }
  if (promo.expiresAt && promo.expiresAt < now) {
    return { ok: false, error: "errors.promoCodeExpired" };
  }
  if (promo.maxUsageCount !== null && promo.currentUsageCount >= promo.maxUsageCount) {
    return { ok: false, error: "errors.promoCodeExhausted" };
  }

  const minimumAmount = promo.minimumAmount ? parseFloat(promo.minimumAmount) : 0;
  if (minimumAmount > 0 && subtotal < minimumAmount) {
    return {
      ok: false,
      error: "errors.promoCodeMinimumNotMet",
      params: { amount: minimumAmount.toFixed(2) },
    };
  }

  const promoValue = parseFloat(promo.value);
  return {
    ok: true,
    promoCodeId: promo.id,
    discountAmount: calculatePromoDiscount(promo, subtotal),
    minimumAmount,
    snapshot: { code: promo.code, type: promo.type, value: promoValue },
  };
};

/** Active promo row of the store matching the code, case-insensitively. */
export const findStorefrontPromoCode = async (
  database: Pick<Database, "select">,
  params: { storeId: string; code: string },
): Promise<PromoCodeEvaluationRow | null> => {
  const [row] = await database
    .select({
      id: promoCodes.id,
      code: promoCodes.code,
      type: promoCodes.type,
      value: promoCodes.value,
      minimumAmount: promoCodes.minimumAmount,
      maxUsageCount: promoCodes.maxUsageCount,
      currentUsageCount: promoCodes.currentUsageCount,
      startsAt: promoCodes.startsAt,
      expiresAt: promoCodes.expiresAt,
    })
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.storeId, params.storeId),
        sql`UPPER(${promoCodes.code}) = UPPER(${params.code})`,
        eq(promoCodes.isActive, true),
      ),
    )
    .limit(1);

  return row ?? null;
};

// ---------------------------------------------------------------------------
// Rate limit: promo validation is public and lets a visitor probe codes.
// Per (store, ip) sliding minute window, in memory (same trade-off as the
// advisor limiter: single replica, fail-closed when saturated).
// ---------------------------------------------------------------------------

const PROMO_ATTEMPTS_PER_MINUTE = 20;
const MAX_PROMO_WINDOW_ENTRIES = 10_000;
const promoWindows = new Map<string, { count: number; resetAt: number }>();

export const checkPromoValidationRateLimit = (
  key: string,
  now: number = Date.now(),
): { allowed: boolean; retryAfter?: number } => {
  if (promoWindows.size > MAX_PROMO_WINDOW_ENTRIES) {
    for (const [entryKey, entry] of promoWindows) {
      if (entry.resetAt <= now) promoWindows.delete(entryKey);
    }
    if (promoWindows.size > MAX_PROMO_WINDOW_ENTRIES) {
      return { allowed: false, retryAfter: 60 };
    }
  }

  const window = promoWindows.get(key);
  if (!window || window.resetAt <= now) {
    promoWindows.set(key, { count: 1, resetAt: now + 60_000 });
    return { allowed: true };
  }

  window.count += 1;
  if (window.count > PROMO_ATTEMPTS_PER_MINUTE) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((window.resetAt - now) / 1000)) };
  }
  return { allowed: true };
};

/**
 * `storefront.promo.validate`: reprice the cart lines from the catalog (never
 * the client's subtotal), then evaluate the code. Read-only: nothing is
 * consumed until the reservation is written.
 */
export const validateStorefrontPromoCode = async (
  database: Pick<Database, "select">,
  params: {
    storeId: string;
    code: string;
    lines: PricingCatalogLineInput[];
    now?: Date;
    timezone?: string;
  },
): Promise<StorefrontPromoValidateOutput> => {
  const catalog = await loadPricingCatalog(database, {
    storeId: params.storeId,
    productIds: params.lines.map((line) => line.productId),
    timezone: params.timezone,
  });

  let subtotal = 0;
  for (const line of params.lines) {
    const product = catalog.get(line.productId);
    if (!product) {
      return { ok: false, error: "errors.productNotFound" };
    }
    subtotal += priceCatalogLine(product, line).subtotal;
  }

  const promo = await findStorefrontPromoCode(database, {
    storeId: params.storeId,
    code: params.code,
  });
  const evaluation = evaluatePromoCode({ promo, subtotal, now: params.now });
  if (!evaluation.ok) {
    return { ok: false, error: evaluation.error, errorParams: evaluation.params };
  }

  return {
    ok: true,
    promo: {
      id: evaluation.promoCodeId,
      code: evaluation.snapshot.code,
      type: evaluation.snapshot.type,
      value: evaluation.snapshot.value,
      discountAmount: evaluation.discountAmount,
      minimumAmount: evaluation.minimumAmount,
      subtotal,
    },
  };
};
