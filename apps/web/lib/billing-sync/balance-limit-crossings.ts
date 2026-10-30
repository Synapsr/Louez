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
 * notice, while the version before it had none. The version before is the store's
 * newest in `stored`, the cache before this write; when the store had none, the one
 * just below among `inserted`, as when a pull fills an empty cache with history. `*`
 * has no owner and is left out.
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
    const previous =
      newest(before) ?? newest(added.filter((version) => version.version < latest.version));
    if (!hasBalanceNotice(previous)) crossings.push({ storeId, version: latest.version });
  }
  return crossings;
}
