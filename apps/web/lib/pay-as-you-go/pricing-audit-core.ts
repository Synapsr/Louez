import type { PayAsYouGoConfig } from '@louez/types';

import { priceForLocationIndex, resolvePayAsYouGoConfig } from './config';

/**
 * Pure checks behind the read-only pricing audit script: rebuild what a store was really
 * charged from its `platform_fee` rows and compare it with the pricing the freeze would
 * write (or has written) on its row.
 *
 * - A manual fee is priced when it is recorded, from its own `monthlyIndex`, and its
 *   amount never changes afterwards (voids and reversals only change status and the
 *   reversed amount). It is exact evidence: it must equal the expected price at its index.
 * - An online fee is the amount collected at checkout. Its price was projected from a
 *   count that also includes marketplace rows, and a manual row upgraded to online keeps
 *   its old index, so its index proves nothing. It is only checked against the set of
 *   prices of the expected pricing. An amount above the highest price comes from the
 *   legacy metadata that recorded the whole application fee, and is reported apart.
 */

export interface AuditFeeRow {
  source: string;
  status: string;
  amountCents: number;
  monthlyIndex: number | null;
  billingMonth: string;
}

export type StoreAuditVerdict = 'match' | 'mismatch' | 'no_evidence';

export interface AuditMonth {
  billingMonth: string;
  manualRows: number;
  onlineRows: number;
  /** Rows the expected pricing cannot explain. */
  mismatched: number;
  /** Distinct amounts actually recorded, in cents, ascending. */
  observedCents: number[];
}

/** One amount seen on manual rows and the monthly positions it was charged at. */
export interface ObservedPrice {
  amountCents: number;
  rows: number;
  fromIndex: number;
  toIndex: number;
}

export interface StoreFeeAudit {
  verdict: StoreAuditVerdict;
  manualRows: number;
  onlineRows: number;
  mismatchedManual: number;
  mismatchedOnline: number;
  /** Online rows above the highest expected price (whole application fee recorded). */
  combinedOnlineRows: number;
  /**
   * Sum over non-voided manual rows of (amount charged − expected price), in cents.
   * Negative: the store paid less than the frozen pricing would charge.
   */
  manualDeltaCents: number;
  /** Price schedule actually charged on manual rows, by amount. */
  observedManualPrices: ObservedPrice[];
  /** Every month with rental fees, oldest first. */
  months: AuditMonth[];
}

/** Every price a config can charge, whatever the monthly position. */
function pricesOf(config: ReturnType<typeof resolvePayAsYouGoConfig>): Set<number> {
  if (config.flatRateCents !== null) return new Set([config.flatRateCents]);
  return new Set(config.tiers.map((tier) => tier.priceCents));
}

/** Compare a store's rental fees (sources `online` and `manual`) with `expected`. */
export function auditStoreFees(expected: PayAsYouGoConfig, fees: AuditFeeRow[]): StoreFeeAudit {
  const config = resolvePayAsYouGoConfig(expected);
  const prices = pricesOf(config);
  const highestPrice = Math.max(...prices);

  const months = new Map<string, AuditMonth & { observed: Set<number> }>();
  const observed = new Map<number, ObservedPrice>();
  const audit: Omit<StoreFeeAudit, 'verdict' | 'observedManualPrices' | 'months'> = {
    manualRows: 0,
    onlineRows: 0,
    mismatchedManual: 0,
    mismatchedOnline: 0,
    combinedOnlineRows: 0,
    manualDeltaCents: 0,
  };

  for (const fee of fees) {
    const month = months.get(fee.billingMonth) ?? {
      billingMonth: fee.billingMonth,
      manualRows: 0,
      onlineRows: 0,
      mismatched: 0,
      observedCents: [],
      observed: new Set<number>(),
    };

    if (fee.source === 'manual' && fee.monthlyIndex !== null) {
      audit.manualRows++;
      month.manualRows++;
      const expectedCents = priceForLocationIndex(config, fee.monthlyIndex);
      if (fee.amountCents !== expectedCents) {
        audit.mismatchedManual++;
        month.mismatched++;
      }
      if (fee.status !== 'voided') audit.manualDeltaCents += fee.amountCents - expectedCents;
      const price = observed.get(fee.amountCents) ?? {
        amountCents: fee.amountCents,
        rows: 0,
        fromIndex: fee.monthlyIndex,
        toIndex: fee.monthlyIndex,
      };
      price.rows++;
      price.fromIndex = Math.min(price.fromIndex, fee.monthlyIndex);
      price.toIndex = Math.max(price.toIndex, fee.monthlyIndex);
      observed.set(fee.amountCents, price);
    } else if (fee.source === 'online') {
      audit.onlineRows++;
      month.onlineRows++;
      if (fee.amountCents > highestPrice) {
        audit.combinedOnlineRows++;
      } else if (!prices.has(fee.amountCents)) {
        audit.mismatchedOnline++;
        month.mismatched++;
      }
    } else {
      continue;
    }

    month.observed.add(fee.amountCents);
    months.set(fee.billingMonth, month);
  }

  const verdict: StoreAuditVerdict =
    audit.mismatchedManual + audit.mismatchedOnline > 0
      ? 'mismatch'
      : audit.manualRows > 0
        ? 'match'
        : 'no_evidence';

  return {
    verdict,
    ...audit,
    observedManualPrices: [...observed.values()].sort((a, b) => a.fromIndex - b.fromIndex),
    months: [...months.values()]
      .sort((a, b) => a.billingMonth.localeCompare(b.billingMonth))
      .map(({ observed: amounts, ...month }) => ({
        ...month,
        observedCents: [...amounts].sort((a, b) => a - b),
      })),
  };
}

export interface AllowanceInput {
  /** Null when the store has no subscription row. */
  freeReservationsGranted: number | null;
  /** Free reservations the freeze gives a store without a row. */
  freezeFreeReservations: number;
  /** Non-voided `free` rows already used. */
  freeReservationsUsed: number;
  /** True when the row was created more than a few seconds after the store (not at onboarding). */
  rowCreatedAfterStore: boolean;
}

/** Notes on the free-reservation allowance for a human to review. The freeze keeps stored values. */
export function auditAllowance(input: AllowanceInput): string[] {
  const notes: string[] = [];
  if (input.freeReservationsGranted === null) {
    notes.push(
      `no subscription row: the freeze creates one with ${input.freezeFreeReservations} free reservations`,
    );
    if (input.freeReservationsUsed > input.freezeFreeReservations) {
      notes.push(
        `already used ${input.freeReservationsUsed} free reservations, more than the ${input.freezeFreeReservations} the freeze grants`,
      );
    }
    return notes;
  }
  if (input.freeReservationsGranted === 0 && input.rowCreatedAfterStore) {
    notes.push(
      '0 free reservations on a row created after the store: an older code path may have written the column default (0) instead of the welcome allowance',
    );
  }
  if (input.freeReservationsUsed > input.freeReservationsGranted) {
    notes.push(
      `used ${input.freeReservationsUsed} free reservations but only ${input.freeReservationsGranted} granted now: the allowance was cut after use`,
    );
  }
  return notes;
}
