import {
  VISIT_SOURCE_PARAM,
  parseVisitSource,
  type VisitSource,
} from "@louez/api/contracts/visibility";

/**
 * A storefront link marked with the channel it is shared on (`?via=qr`), so
 * the visits it brings are counted for that channel. Keeps the link's own
 * query and hash; an unparsable URL is returned as it is.
 */
export function withVisitSource(url: string, source: VisitSource): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(VISIT_SOURCE_PARAM, source);
    return parsed.toString();
  } catch {
    return url;
  }
}

/** The visit source a page's query string names (`?via=`), or null. */
export function readVisitSource(search: string): VisitSource | null {
  return parseVisitSource(new URLSearchParams(search).get(VISIT_SOURCE_PARAM));
}
