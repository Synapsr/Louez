import type { StoreTheme } from "@louez/types";

/** The announcement line the storefront shows, once trimmed and checked. */
export interface StoreAnnouncementLine {
  text: string;
  /** Where the line links to; null for plain text. */
  href: string | null;
  /** The href leaves the storefront, so the link opens in a new tab. */
  external: boolean;
}

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Whether an href points at another site: an absolute http(s) URL or a
 * protocol-relative one. Store-relative paths, anchors, `mailto:` and
 * `tel:` links stay in the storefront.
 */
export const isExternalHref = (href: string): boolean => {
  if (href.startsWith("//")) {
    return true;
  }

  try {
    return EXTERNAL_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
};

/**
 * The announcement bar content, or null when the store turned it off or
 * left it blank. A blank href counts as no link.
 */
export const resolveStoreAnnouncement = (
  theme: Pick<StoreTheme, "announcement"> | null | undefined,
): StoreAnnouncementLine | null => {
  const announcement = theme?.announcement;

  if (!announcement?.enabled) {
    return null;
  }

  const text = announcement.text.trim();

  if (text === "") {
    return null;
  }

  const href = announcement.href?.trim() || null;

  return { text, href, external: href !== null && isExternalHref(href) };
};
