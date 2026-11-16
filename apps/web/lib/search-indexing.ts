import { z } from "zod";

/**
 * Search indexing switch, `LOUEZ_SEARCH_INDEXING`: whether search engines may index
 * this instance.
 * - `on` (the default): storefronts are indexable as usual. Every self-hosted store
 *   keeps its search presence without setting anything.
 * - `off`: a staging or test instance. Every page answers `noindex, nofollow` (robots
 *   meta tag and `X-Robots-Tag` header), robots.txt disallows the whole site and names
 *   no sitemap, and the sitemap is empty.
 *
 * Decided by this variable alone, never by the domain: an instance on any domain may be
 * a real store.
 */
export type SearchIndexing = "on" | "off";

/** The env schema (apps/web/env.ts): `on`, `off`, or unset, which means on. */
export const louezSearchIndexingSchema = z.enum(["on", "off"]).optional();

/** The robots directive every response carries while indexing is off. */
export const NO_INDEX_DIRECTIVE = "noindex, nofollow";

/** The same directive as Next metadata, for the robots meta tag. */
export const NO_INDEX_ROBOTS = { index: false, follow: false } as const;

/** Only `off` turns indexing off, so a store never drops out of search by accident. */
export function resolveSearchIndexing(raw: unknown): SearchIndexing {
  return raw === "off" ? "off" : "on";
}

/**
 * Read from process.env at call time, like `isStandaloneMode()`: the prebuilt Docker
 * image honors the runtime value, and the proxy can call it without the env schema.
 */
export function isSearchIndexingEnabled(): boolean {
  return resolveSearchIndexing(process.env.LOUEZ_SEARCH_INDEXING) === "on";
}
