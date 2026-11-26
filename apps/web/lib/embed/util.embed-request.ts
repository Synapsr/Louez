/**
 * The storefront widget's page (`/[slug]/embed`), as the proxy marks it: it
 * removes this header from every storefront request, then sets it on an embed
 * route. The storefront layout drops its chrome for it, and the root layout
 * its marketing trackers (lib/util.client-tracking.ts).
 */
export const EMBED_MODE_HEADER = "x-embed-mode";

export const isEmbedRequest = (headers: Pick<Headers, "get">): boolean =>
  headers.get(EMBED_MODE_HEADER) === "1";
