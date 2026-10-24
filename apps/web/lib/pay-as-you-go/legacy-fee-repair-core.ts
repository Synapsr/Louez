/**
 * The pure parts of the nightly legacy fee report (legacy-fee-repair.ts): when it
 * runs, the window it reads, and how it sorts what it finds.
 */

/**
 * What the report looks for, each a fee effect that may have been lost:
 * - `record` (A): a pay-as-you-go reservation fee never recorded;
 * - `marketplace` (B): a marketplace fee never recorded;
 * - `void` (V): a fee never voided after a cancellation.
 */
export const LEGACY_FEE_KINDS = ["record", "marketplace", "void"] as const;
export type LegacyFeeKind = (typeof LEGACY_FEE_KINDS)[number];

export type LegacyFeeClass =
  | "mode_changed"
  | "owned_by_webhook"
  | "open_session"
  | "month_closed"
  | "missed";

/**
 * The classes of each kind, in the order they are tried: the first that matches
 * wins. `missed` is what is left, the effects a repair would write. A marketplace
 * fee has no `open_session`: payment requests and extensions never take it.
 */
export const LEGACY_FEE_CLASSES: Record<LegacyFeeKind, readonly LegacyFeeClass[]> = {
  record: ["mode_changed", "owned_by_webhook", "open_session", "month_closed", "missed"],
  marketplace: ["owned_by_webhook", "month_closed", "missed"],
  void: ["month_closed", "missed"],
};

/** What the database says about a candidate. A kind ignores the flags it has no class for. */
export interface LegacyFeeCandidateFlags {
  /** The subscription changed after the reservation became billable: the store may have been on a plan then. */
  modeChanged: boolean;
  /** A Stripe rental payment is pending or done: the Connect webhook records its fee. */
  ownedByWebhook: boolean;
  /** An open rental payment request or extension checkout may still take the pay-as-you-go fee at source. */
  openSession: boolean;
  /** The monthly run has billed the fee's month, or invoiced it for this store: it never comes back to it. */
  monthClosed: boolean;
}

export interface LegacyFeeCandidate {
  kind: LegacyFeeKind;
  reservationId: string;
  storeId: string;
  /** `billable_at`, or the withdrawal time for a void. */
  at: Date;
  flags: LegacyFeeCandidateFlags;
}

const CLASS_MATCHES: Record<LegacyFeeClass, (flags: LegacyFeeCandidateFlags) => boolean> = {
  mode_changed: (flags) => flags.modeChanged,
  owned_by_webhook: (flags) => flags.ownedByWebhook,
  open_session: (flags) => flags.openSession,
  month_closed: (flags) => flags.monthClosed,
  missed: () => true,
};

export function classifyLegacyFeeCandidate(
  kind: LegacyFeeKind,
  flags: LegacyFeeCandidateFlags,
): LegacyFeeClass {
  return LEGACY_FEE_CLASSES[kind].find((name) => CLASS_MATCHES[name](flags)) ?? "missed";
}

/** Effects run right after commit: leave the last minutes to the ones still running. */
export const LEGACY_FEE_REPORT_DELAY_MS = 15 * 60_000;

/**
 * From the UTC start of the previous month to 15 minutes ago. Two months, so a
 * missed night, or a miss on the last day of a month, is still seen the next night.
 */
export function legacyFeeReportWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    to: new Date(now.getTime() - LEGACY_FEE_REPORT_DELAY_MS),
  };
}

/** 04:45 UTC: a free cron slot, before the monthly billing at 05:00 UTC on the 1st. */
export function isLegacyFeeReportTick(now: Date): boolean {
  return now.getUTCHours() === 4 && now.getUTCMinutes() === 45;
}

/** Candidates listed in the log per kind and class. The counts cover all of them. */
export const LOGGED_CANDIDATES_PER_CLASS = 100;

export type LegacyFeeCounts = Record<LegacyFeeKind, Partial<Record<LegacyFeeClass, number>>>;

export interface LegacyFeeCandidateGroup {
  kind: LegacyFeeKind;
  class: LegacyFeeClass;
  count: number;
  /**
   * The newest ones, at most LOGGED_CANDIDATES_PER_CLASS: the ones dated after a
   * deploy are the ones to read.
   */
  candidates: { reservationId: string; storeId: string; at: string }[];
}

/** The counts of every kind and class, zeros included, and a group per class found. */
export function summarizeLegacyFeeCandidates(candidates: readonly LegacyFeeCandidate[]): {
  counts: LegacyFeeCounts;
  groups: LegacyFeeCandidateGroup[];
} {
  const counts: LegacyFeeCounts = { record: {}, marketplace: {}, void: {} };
  for (const kind of LEGACY_FEE_KINDS) {
    for (const name of LEGACY_FEE_CLASSES[kind]) counts[kind][name] = 0;
  }

  const groups = new Map<string, LegacyFeeCandidateGroup>();
  const newestFirst = [...candidates].sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const candidate of newestFirst) {
    const { kind, reservationId, storeId, at } = candidate;
    const name = classifyLegacyFeeCandidate(kind, candidate.flags);
    counts[kind][name] = (counts[kind][name] ?? 0) + 1;

    const key = `${kind}:${name}`;
    const group = groups.get(key) ?? { kind, class: name, count: 0, candidates: [] };
    group.count += 1;
    if (group.candidates.length < LOGGED_CANDIDATES_PER_CLASS) {
      group.candidates.push({ reservationId, storeId, at: at.toISOString() });
    }
    groups.set(key, group);
  }

  return { counts, groups: [...groups.values()] };
}
