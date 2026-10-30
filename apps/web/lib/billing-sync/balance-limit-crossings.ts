import type { PolicyNoticeKind } from "@/lib/billing-sync/policies";

// Which cached versions start the balance limit's email (louez-billing docs/api,
// README §8.8): a store version whose notice is `balance_limit_near` or
// `balance_limit_reached` while the store's version before it had neither.
//
// Once per version: only the transaction that inserts a (storeId, version) row, which
// the table's primary key allows once, reports it as a crossing.

const BALANCE_NOTICES: ReadonlySet<PolicyNoticeKind> = new Set([
  "balance_limit_near",
  "balance_limit_reached",
]);

/** What a crossing reads of a cached store version. */
export type CachedNotice = {
  readonly storeId: string;
  readonly version: number;
  readonly noticeKind: PolicyNoticeKind | null;
};

export type BalanceLimitCrossing = { readonly storeId: string; readonly version: number };

const hasBalanceNotice = (version: CachedNotice | undefined) =>
  version?.noticeKind != null && BALANCE_NOTICES.has(version.noticeKind);

function newest(list: readonly CachedNotice[]): CachedNotice | undefined {
  return list.reduce<CachedNotice | undefined>(
    (best, version) => (best === undefined || version.version > best.version ? version : best),
    undefined,
  );
}

/**
 * The stores whose newest version is one `inserted` just cached and carries a balance
 * notice, and whose run of balance notices started in this write: the newest version
 * before that run, among `inserted` or else in `stored` (the cache before this write),
 * had none, or there is none. A run that reaches into `stored` was announced already. So
 * a pull that fills an empty cache with ok, near, reached sends one email, for the
 * newest version. `*` has no owner and is left out.
 */
export function balanceLimitCrossings(
  stored: readonly CachedNotice[],
  inserted: readonly CachedNotice[],
): BalanceLimitCrossing[] {
  const crossings: BalanceLimitCrossing[] = [];
  const storeIds = new Set(inserted.map((version) => version.storeId));
  storeIds.delete("*");
  for (const storeId of storeIds) {
    const before = stored.filter((version) => version.storeId === storeId);
    const added = inserted.filter((version) => version.storeId === storeId);
    const latest = newest([...before, ...added]);
    if (!latest || !added.includes(latest) || !hasBalanceNotice(latest)) continue;
    const cached = newest(before);
    // The new versions above the cache, newest first: the run of notices is read down them.
    const fresh = added
      .filter((version) => cached === undefined || version.version > cached.version)
      .toSorted((a, b) => b.version - a.version);
    const endOfRun = fresh.find((version) => !hasBalanceNotice(version));
    if (endOfRun !== undefined || !hasBalanceNotice(cached)) {
      crossings.push({ storeId, version: latest.version });
    }
  }
  return crossings;
}
