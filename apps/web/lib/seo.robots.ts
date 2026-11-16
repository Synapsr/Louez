import type { Metadata } from "next";

import { NO_INDEX_ROBOTS, isSearchIndexingEnabled } from "@/lib/search-indexing";

// Rich thumbnails in search results — without this Google caps previews for
// pages it has no explicit signal for.
const STORE_PAGE_ROBOTS: NonNullable<Metadata["robots"]> = {
  index: true,
  follow: true,
  "max-image-preview": "large",
  "max-snippet": -1,
};

/**
 * A store page's robots: a funnel or result page stays out of the index but its links
 * to products and to the catalog still count; any other page is indexable. With search
 * indexing off (LOUEZ_SEARCH_INDEXING=off), no page is.
 */
export function getStorePageRobots(noIndex: boolean): NonNullable<Metadata["robots"]> {
  if (!isSearchIndexingEnabled()) return NO_INDEX_ROBOTS;
  return noIndex ? { index: false, follow: true } : STORE_PAGE_ROBOTS;
}
