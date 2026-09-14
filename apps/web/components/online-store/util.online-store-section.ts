import {
  ONLINE_STORE_BASE_PATH,
  ONLINE_STORE_SECTIONS,
  type OnlineStoreSection,
} from "./online-store.constants";

const isOnlineStoreSection = (value: string): value is OnlineStoreSection =>
  (ONLINE_STORE_SECTIONS as readonly string[]).includes(value);

/**
 * The section an editor URL points at: `/online-store/home` → `home`.
 * Null for the editor root, an unknown segment, or a path outside the editor.
 */
export const getOnlineStoreSectionFromPathname = (pathname: string): OnlineStoreSection | null => {
  if (!pathname.startsWith(`${ONLINE_STORE_BASE_PATH}/`)) return null;

  const segment = pathname.slice(ONLINE_STORE_BASE_PATH.length + 1).split(/[/?#]/)[0] ?? "";

  return isOnlineStoreSection(segment) ? segment : null;
};
