import { DEFAULT_STORE_HOME_SECTIONS, type StoreHomeSections } from "@louez/types";

interface StoreHomeSectionsSource {
  /** Partial on purpose: a theme saved before a block existed has no entry for it. */
  homeSections?: Partial<StoreHomeSections> | null;
}

/**
 * Which optional home blocks a store shows. Every block is on until the
 * store turns it off, so a theme saved before a block existed still shows it.
 */
export const resolveStoreHomeSections = (
  theme: StoreHomeSectionsSource | null | undefined,
): StoreHomeSections => ({ ...DEFAULT_STORE_HOME_SECTIONS, ...theme?.homeSections });
