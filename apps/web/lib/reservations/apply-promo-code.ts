import { and, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";

import {
  evaluatePromoCode,
  findStorefrontPromoCode,
  type PromoCodeEvaluation,
} from "@louez/api/services/promo";
import type { Database, Transaction } from "@louez/db";
import { promoCodes } from "@louez/db/schema";

export { calculatePromoDiscount, evaluatePromoCode } from "@louez/api/services/promo";
export type { PromoCodeEvaluation, PromoCodeEvaluationRow } from "@louez/api/services/promo";

export type AppliedPromoCode = Extract<PromoCodeEvaluation, { ok: true }>;

/**
 * Pre-check outside the transaction: find the store's code and evaluate it on
 * the priced subtotal. Nothing is consumed here, so a concurrent checkout can
 * still win the last use; `consumePromoCode` settles that inside the write.
 */
export const applyPromoCode = async (
  database: Pick<Database, "select">,
  params: {
    storeId: string;
    code: string;
    subtotal: number;
    discountableSubtotal?: number;
    now?: Date;
  },
): Promise<PromoCodeEvaluation> => {
  const promo = await findStorefrontPromoCode(database, {
    storeId: params.storeId,
    code: params.code,
  });
  return evaluatePromoCode({
    promo,
    subtotal: params.subtotal,
    discountableSubtotal: params.discountableSubtotal,
    now: params.now,
  });
};

/** `id = ? AND is_active AND (max_usage_count IS NULL OR current_usage_count < max_usage_count)` */
export const buildConsumePromoCodeCondition = (promoCodeId: string): SQL => {
  const condition = and(
    eq(promoCodes.id, promoCodeId),
    eq(promoCodes.isActive, true),
    or(
      isNull(promoCodes.maxUsageCount),
      lt(promoCodes.currentUsageCount, promoCodes.maxUsageCount),
    ),
  );
  // `and()` only returns undefined when called without conditions.
  return condition ?? sql`false`;
};

/**
 * Guarded usage increment inside the reservation transaction:
 * `UPDATE ... SET current = current + 1 WHERE id = ? AND active AND (max IS NULL OR current < max)`.
 * Zero affected rows means the code was exhausted (or deactivated) since the
 * pre-check; the caller must roll back with `errors.promoCodeExhausted`.
 */
export const consumePromoCode = async (
  tx: Pick<Transaction, "update">,
  promoCodeId: string,
): Promise<boolean> => {
  const [result] = await tx
    .update(promoCodes)
    .set({
      currentUsageCount: sql`${promoCodes.currentUsageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(buildConsumePromoCodeCondition(promoCodeId));

  return result.affectedRows > 0;
};
