import type { NeedsALook } from "@/lib/inbox/needs-a-look";
import {
  describeNeedsALookItem,
  type DisplayFormat,
  type DisplayMessage,
} from "@/lib/inbox/needs-a-look-display";

/** The page that holds every item to check, its details and "Mark as handled". */
export const NEEDS_A_LOOK_PAGE = "/dashboard/inbox";

/** Items to check the bell lists, the most recent first. */
export const NEEDS_A_LOOK_IN_BELL = 5;

/** The bell's read of what needs a look, as React Query reports it. */
export interface NeedsALookRead {
  status: "pending" | "error" | "success";
  data?: NeedsALook;
}

export interface NeedsALookBellRow {
  id: string;
  title: DisplayMessage;
  /** Booking · customer · amount, what applies. */
  line: string[];
  /** Where the item is fixed, as the page's row opens it; the page when nowhere else. */
  href: string;
}

/**
 * What the bell shows of what needs a look: only what a successful read gave.
 * A read still loading, or in error (refused, timed out), shows nothing, even
 * when it still holds an earlier answer; so does an empty one. The rows are
 * the most recent of what the read holds: one page of the inbox, its oldest
 * items first.
 */
export function needsALookInBell(
  read: NeedsALookRead,
  format: DisplayFormat,
): { count: number; rows: NeedsALookBellRow[] } | null {
  if (read.status !== "success" || !read.data || read.data.items.length === 0) return null;
  // The inbox gives the oldest first.
  const rows = read.data.items
    .slice(-NEEDS_A_LOOK_IN_BELL)
    .reverse()
    .map((item) => {
      const display = describeNeedsALookItem(item, format);
      return {
        id: item.id,
        title: display.title,
        line: display.line,
        href: display.action?.href ?? NEEDS_A_LOOK_PAGE,
      };
    });
  return { count: read.data.items.length, rows };
}

/**
 * The bell's badge: the polled counts (pending requests, supplier invoices)
 * as soon as the poll gives them, plus the items to check once read
 * (`needsALookInBell`'s count: none while loading, paused or failed). The
 * inbox never holds the badge back.
 */
export function notificationsBadge({
  polled,
  toCheck,
}: {
  polled: number;
  toCheck: number;
}): string | null {
  const total = polled + toCheck;
  if (total <= 0) return null;
  return total > 9 ? "9+" : String(total);
}
