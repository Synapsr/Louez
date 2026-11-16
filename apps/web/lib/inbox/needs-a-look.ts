import type { InboxItem, InboxItemType } from "@louez/api/contracts/inbox";
import { INBOX_PAGE_MAX } from "@louez/api/contracts/inbox";

/**
 * What needs a look: the inbox items Louez could not settle on its own and
 * that the dashboard shows nowhere else. Daily work (booking requests, late
 * pickups and returns, overbookings, failed payments, expiring deposits) keeps
 * its own place in the dashboard; so do the billing gate (its banner), unit
 * conflicts (the product and reservation pages) and failed photo jobs (only
 * an agent starts them, and follows them). Change this list to change the
 * page, the home's line and the sidebar's dot together.
 */
export const NEEDS_A_LOOK_TYPES = [
  "refund_unconfirmed",
  "refund_undone",
  "credit_note_not_issued",
  "deposit_unconfirmed",
  "deposit_release_failed",
  "dispute_open",
  "einvoice_rejected",
  "message_not_sent",
  "invitation_not_sent",
  "operation_unknown",
] as const satisfies readonly InboxItemType[];

export type NeedsALookType = (typeof NEEDS_A_LOOK_TYPES)[number];

export type NeedsALookItem = InboxItem & { type: NeedsALookType };

export const isNeedsALookItem = (item: InboxItem): item is NeedsALookItem =>
  (NEEDS_A_LOOK_TYPES as readonly string[]).includes(item.type);

/** The part of the inbox client this module calls: the dashboard's, or a test's. */
export interface InboxReader {
  list: (
    input: { types: NeedsALookType[]; limit: number },
    options?: { signal?: AbortSignal },
  ) => Promise<{
    items: InboxItem[];
    hasMore: boolean;
    unavailable?: InboxItemType[];
  }>;
}

export interface InboxAcknowledger {
  acknowledge: (input: { items: Array<{ id: string; occurredAt: Date }> }) => Promise<{
    acknowledged: number;
    alreadyAcknowledged: number;
  }>;
}

export interface NeedsALook {
  items: NeedsALookItem[];
  /** More items wait past the page: the count reads "99+". */
  more: boolean;
  /** Some kinds could not be read this time: the list may be incomplete. */
  incomplete: boolean;
}

/**
 * What needs a look, as the caller may see it: one read of the inbox, filtered
 * to NEEDS_A_LOOK_TYPES. The API shows each kind only to who may read it.
 */
export async function loadNeedsALook(
  inbox: InboxReader,
  limit: number = INBOX_PAGE_MAX,
  signal?: AbortSignal,
): Promise<NeedsALook> {
  const page = await inbox.list({ types: [...NEEDS_A_LOOK_TYPES], limit }, { signal });
  return {
    items: page.items.filter(isNeedsALookItem),
    more: page.hasMore,
    incomplete: (page.unavailable?.length ?? 0) > 0,
  };
}

/** How long the sidebar's marker and the home's line wait for the inbox before showing nothing. */
export const NEEDS_A_LOOK_TIMEOUT_MS = 5_000;

/**
 * `loadNeedsALook`, given up after `timeoutMs` (or when `signal` aborts): the
 * request is aborted and the call rejects, so a slow inbox shows no marker
 * rather than holding anything up.
 */
export async function loadNeedsALookWithin(
  inbox: InboxReader,
  {
    timeoutMs = NEEDS_A_LOOK_TIMEOUT_MS,
    signal,
  }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<NeedsALook> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("The inbox did not answer in time.")),
    timeoutMs,
  );
  const givenUp = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
      once: true,
    });
  });
  try {
    return await Promise.race([loadNeedsALook(inbox, INBOX_PAGE_MAX, controller.signal), givenUp]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** Whether the sidebar's entry carries its marker: something read, and waiting. Nothing read yet, or a failed read: no marker. */
export const needsALookWaiting = (summary: NeedsALook | undefined): boolean =>
  (summary?.items.length ?? 0) > 0;

/** Past this, the count reads "99+". */
export const NEEDS_A_LOOK_COUNT_MAX = 99;

/** The count as shown: the number, or "99+" past the page or past 99. */
export function needsALookCount({ items, more }: Pick<NeedsALook, "items" | "more">): {
  count: number;
  capped: boolean;
} {
  const capped = more || items.length > NEEDS_A_LOOK_COUNT_MAX;
  return { count: capped ? NEEDS_A_LOOK_COUNT_MAX : items.length, capped };
}

/**
 * Marks an item handled for the whole store. "handled": it leaves the list.
 * "changed": the inbox no longer holds it as shown (handled already, or it
 * came back since): the list is read again. A refusal throws the API's error.
 */
export async function acknowledgeNeedsALook(
  inbox: InboxAcknowledger,
  item: Pick<InboxItem, "id" | "occurredAt">,
): Promise<"handled" | "changed"> {
  const result = await inbox.acknowledge({
    items: [{ id: item.id, occurredAt: new Date(item.occurredAt) }],
  });
  return result.acknowledged + result.alreadyAcknowledged > 0 ? "handled" : "changed";
}
