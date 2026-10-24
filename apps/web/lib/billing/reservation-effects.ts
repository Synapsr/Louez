import { and, eq } from "drizzle-orm";

import {
  db,
  isBillableReservationStatus,
  isFeeVoidingReservationStatus,
  reservations,
} from "@louez/db";
import type {
  ReservationBillingEffect,
  ReservationEffectRunner,
  ReservationStatus,
} from "@louez/db";

import { isBillingEnabled } from "@/lib/billing/mode";
import { log } from "@/lib/evlog";
import {
  recordMarketplaceFee,
  recordReservationFee,
  voidReservationFee,
} from "@/lib/pay-as-you-go/metering";

type RecordEffect = Extract<ReservationBillingEffect, { type: "legacy_fee.record" }>;

export interface LegacyFeeEffectDeps {
  isBillingEnabled: () => boolean;
  /** The reservation's status now, or null when it no longer exists. */
  readReservationStatus: (
    reservationId: string,
    storeId: string,
  ) => Promise<ReservationStatus | null>;
  recordReservationFee: typeof recordReservationFee;
  recordMarketplaceFee: typeof recordMarketplaceFee;
  voidReservationFee: typeof voidReservationFee;
  log: {
    error(tag: string, message: string): void;
    info(tag: string, message: string): void;
  };
}

async function readReservationStatus(
  reservationId: string,
  storeId: string,
): Promise<ReservationStatus | null> {
  const [row] = await db
    .select({ status: reservations.status })
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)))
    .limit(1);
  return row?.status ?? null;
}

const defaultDeps: LegacyFeeEffectDeps = {
  isBillingEnabled,
  readReservationStatus,
  recordReservationFee,
  recordMarketplaceFee,
  voidReservationFee,
  log,
};

/**
 * The message, then each cause's code and message. Drizzle's message is only the
 * failed SQL: the driver's reason (ECONNREFUSED, a deadlock) is in `cause`.
 */
function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth += 1) {
    if (!(current instanceof Error)) {
      parts.push(String(current));
      break;
    }
    const code = "code" in current && typeof current.code === "string" ? current.code : "";
    const label = code && !current.message.includes(code) ? code : "";
    const part = [label, current.message].filter(Boolean).join(": ");
    if (part) parts.push(part);
    current = current.cause;
  }
  return parts.join(", caused by ");
}

/**
 * Runs the pay-as-you-go fees of committed status changes and inserts, in order.
 * The fee functions decide whether the store pays them. It never throws: a fee
 * failure is logged, and the change it follows stays as it is.
 */
export function createLegacyFeeEffectRunner(
  overrides: Partial<LegacyFeeEffectDeps> = {},
): ReservationEffectRunner {
  const deps: LegacyFeeEffectDeps = { ...defaultDeps, ...overrides };

  const attempt = async (
    action: string,
    effect: ReservationBillingEffect,
    call: () => Promise<unknown>,
  ): Promise<void> => {
    try {
      await call();
    } catch (error) {
      deps.log.error(
        "payg",
        `could not ${action} for reservation ${effect.reservationId} (store ${effect.storeId}): ${describeError(error)}`,
      );
    }
  };

  const voidFee = (effect: ReservationBillingEffect) =>
    attempt("void the fees", effect, () => deps.voidReservationFee(effect.reservationId));

  /** The status now, null when the row is gone, undefined when the read failed (logged). */
  const readStatus = async (effect: RecordEffect, onFailure: string) => {
    try {
      return await deps.readReservationStatus(effect.reservationId, effect.storeId);
    } catch (error) {
      deps.log.error(
        "payg",
        `${onFailure}: could not read the status of reservation ${effect.reservationId} (store ${effect.storeId}): ${describeError(error)}`,
      );
      return undefined;
    }
  };

  const voidWithdrawn = async (effect: RecordEffect, status: ReservationStatus | null) => {
    deps.log.info(
      "payg",
      `reservation ${effect.reservationId} is ${status ?? "gone"}: voiding its fees`,
    );
    await voidFee(effect);
  };

  const recordFee = async (effect: RecordEffect) => {
    const { storeId, reservationId, at } = effect;
    // Without the status, a record could charge a rental cancelled meanwhile.
    const status = await readStatus(effect, "fee not recorded");
    if (status === undefined) return;

    // A cancellation committed after this change, and its void may already have
    // run. Recording now would leave a pending fee and use a free credit.
    if (status === null || isFeeVoidingReservationStatus(status)) {
      await voidWithdrawn(effect, status);
      return;
    }

    // No change leads from the billable set back to pending or quote. A void here
    // could drop a fee the webhook recorded before the payment confirmed it.
    if (!isBillableReservationStatus(status)) {
      deps.log.error(
        "payg",
        `fee not recorded: reservation ${reservationId} (store ${storeId}) is still ${status}. Did its effects run before the transaction committed?`,
      );
      return;
    }

    // Separate calls, so a failed reservation fee still records the marketplace fee.
    await attempt("record the reservation fee", effect, () =>
      deps.recordReservationFee({ storeId, reservationId, source: "manual", at }),
    );
    if (effect.marketplace) {
      await attempt("record the marketplace fee", effect, () =>
        deps.recordMarketplaceFee({ storeId, reservationId, source: "manual", at }),
      );
    }

    // A cancellation can commit between the first read and the insert, and its void
    // find nothing. It commits before its void runs, so either this read sees it,
    // or that void runs after the insert and voids the fees itself.
    const after = await readStatus(effect, "fees recorded, not checked for a cancellation");
    if (after === null || (after !== undefined && isFeeVoidingReservationStatus(after))) {
      await voidWithdrawn(effect, after);
    }
  };

  return async (effects) => {
    if (effects.length === 0 || !deps.isBillingEnabled()) return;
    for (const effect of effects) {
      if (effect.type === "legacy_fee.record") await recordFee(effect);
      else if (effect.type === "legacy_fee.void") await voidFee(effect);
    }
  };
}

/** Run right after the transaction that returned the effects commits. */
export const runReservationEffects: ReservationEffectRunner = createLegacyFeeEffectRunner();
