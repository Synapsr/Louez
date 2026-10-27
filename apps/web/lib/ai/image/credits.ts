import { and, eq, gte, sql } from "drizzle-orm";

import { aiCreditDebits, aiCredits, db, isDuplicateKeyError } from "@louez/db";

import {
  checkAdvisorCredits,
  getAiCreditsInfo,
  type AdvisorCreditCheck,
} from "@/lib/ai/advisor/credits";
import { isImageBackgroundRemovalEnabled } from "@/lib/ai/image/background-removal";
import { resolveImageApiKey } from "@/lib/ai/image/provider";
import { CREDIT_MICRO, getImageEnhanceCredits, imageEnhanceBillMicro } from "@/lib/ai/pricing";
import { log } from "@/lib/evlog";
import type { Plan } from "@/lib/plans";

/**
 * Whether the complete enhancement pipeline is available: GPT Image creates
 * the polished white-background photo, then the private rembg service isolates
 * it. Billing is a separate, independent knob — the feature can run unbilled.
 */
export function isAiImageEnhanceEnabled(): boolean {
  return resolveImageApiKey() !== null && isImageBackgroundRemovalEnabled();
}

/**
 * Pre-call credit gate. Image operations share the advisor's balance, but
 * their billing can be active through a flat per-image tariff ALONE (no USD
 * cost basis configured) — in that mode the advisor gate is inert, so gate on
 * the balance directly; otherwise defer to the shared gate. Fail-closed.
 */
export async function checkImageCredits(
  storeId: string,
  plan: Plan,
  flatCredits: number,
): Promise<AdvisorCreditCheck> {
  if (flatCredits > 0) {
    try {
      const info = await getAiCreditsInfo(storeId, plan);
      const monthlyOk = info.monthlyRemainingMicro === null || info.monthlyRemainingMicro > 0;
      if (monthlyOk || info.prepaidBalanceMicro > 0) return { allowed: true };
      return { allowed: false, code: "credits_exhausted" };
    } catch (error) {
      log.error(
        "image",
        `credit check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { allowed: false, code: "credits_exhausted" };
    }
  }
  return checkAdvisorCredits(storeId, plan);
}

/** Gate for the GPT Image enhancement operation (flat env tariff). */
export function checkImageEnhanceCredits(storeId: string, plan: Plan): Promise<AdvisorCreditCheck> {
  return checkImageCredits(storeId, plan, getImageEnhanceCredits());
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Start of the current calendar month (the monthly-allowance reset boundary). */
function startOfCalendarMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Sum of the monthly-pocket consumption for a store this calendar month. */
async function sumMonthlyUsedMicro(tx: Tx, storeId: string): Promise<number> {
  const [row] = await tx
    .select({
      used: sql<number>`COALESCE(SUM(${aiCreditDebits.fromMonthlyMicro}), 0)`.mapWith(Number),
    })
    .from(aiCreditDebits)
    .where(
      and(
        eq(aiCreditDebits.storeId, storeId),
        gte(aiCreditDebits.createdAt, startOfCalendarMonth()),
      ),
    );
  return row?.used ?? 0;
}

/**
 * Flat, two-pocket debit for ONE successfully processed image. Called AFTER
 * the result is stored, so a store is never charged for an image it did not
 * get. There is no per-conversation cap here: the tariff is already a fixed
 * amount per image, and the debit is idempotent through the UNIQUE dedup key
 * (`imgenh:<objectId>` / `imgbg:<objectId>`), so a retried request can never
 * double-charge. `billMicro` defaults to the enhancement tariff; the
 * standalone background-removal path passes its own.
 *
 * Returns the micro-credits actually debited (0 when billing is inert).
 */
export async function recordImageEnhanceDebit(
  storeId: string,
  params: {
    dedupKey: string;
    imageKey: string;
    plan: Plan;
    costMicroUsd: number;
    billMicro?: number;
  },
): Promise<number> {
  const { costMicroUsd, dedupKey, imageKey, plan } = params;

  // The real provider cost is frozen on the row regardless of what is billed,
  // so cost-vs-billed stays comparable per revenue line.
  const billMicro = params.billMicro ?? imageEnhanceBillMicro();
  if (billMicro <= 0 && costMicroUsd <= 0) return 0;

  try {
    return await db.transaction(async (tx) => {
      // Cost-only row (tariff unset but the real cost is known): freeze the cost
      // for reporting without touching any balance. Still exactly-once.
      if (billMicro <= 0) {
        await tx.insert(aiCreditDebits).values({
          storeId,
          kind: "image_enhancement",
          imageKey,
          dedupKey,
          costMicroUsd,
          debitedMicro: 0,
          fromMonthlyMicro: 0,
          fromPrepaidMicro: 0,
        });
        return 0;
      }

      // Serialize a store's debits by locking the ai_credits row up front
      // (creating it on demand) so the monthly split is race-free and the
      // prepaid decrement always lands.
      await tx.insert(aiCredits).values({ storeId }).onDuplicateKeyUpdate({ set: { storeId } });
      await tx
        .select({ balanceMicro: aiCredits.balanceMicro })
        .from(aiCredits)
        .where(eq(aiCredits.storeId, storeId))
        .for("update");

      // Split across the monthly-included pocket first, then prepaid.
      const perMonth = plan.features.aiCreditsPerMonth;
      let fromMonthly = 0;
      if (perMonth === null) {
        fromMonthly = billMicro; // unlimited monthly allowance
      } else if (perMonth > 0) {
        const monthlyUsed = await sumMonthlyUsedMicro(tx, storeId);
        const monthlyRemaining = Math.max(0, perMonth * CREDIT_MICRO - monthlyUsed);
        fromMonthly = Math.min(billMicro, monthlyRemaining);
      }
      const fromPrepaid = billMicro - fromMonthly;

      // Insert the debit first — the UNIQUE dedup key makes it exactly-once (a
      // retry throws and rolls back the whole tx, so nothing is double-debited).
      await tx.insert(aiCreditDebits).values({
        storeId,
        kind: "image_enhancement",
        imageKey,
        dedupKey,
        costMicroUsd,
        debitedMicro: billMicro,
        fromMonthlyMicro: fromMonthly,
        fromPrepaidMicro: fromPrepaid,
      });

      // Only the prepaid portion touches the stored balance. It may dip
      // slightly negative on the image that exhausts the balance (bounded by
      // the flat tariff) rather than lose an already-delivered result; the
      // shortfall nets against the next top-up.
      if (fromPrepaid > 0) {
        await tx
          .update(aiCredits)
          .set({
            balanceMicro: sql`${aiCredits.balanceMicro} - ${fromPrepaid}`,
            totalUsedMicro: sql`${aiCredits.totalUsedMicro} + ${fromPrepaid}`,
            updatedAt: new Date(),
          })
          .where(eq(aiCredits.storeId, storeId));
      }

      return billMicro;
    });
  } catch (error) {
    // A retry of an already-billed enhancement hits the UNIQUE dedup key and
    // rolls back — expected and harmless, the image was already paid for.
    if (isDuplicateKeyError(error)) return 0;

    // Anything else (outage, missing migration, deadlock) means the result is
    // NOT accounted for — rethrow so the caller can withhold it rather than
    // hand it out for free.
    log.error(
      "image",
      `recordImageEnhanceDebit failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}
