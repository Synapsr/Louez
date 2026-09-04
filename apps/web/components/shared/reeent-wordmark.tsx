import type { ReactNode } from "react";

/**
 * The reeent wordmark as the partner renders it on the marketplace: Bricolage
 * Grotesque 800, tight tracking, lowercase, brand orange. Reserved for places
 * where the name stands as a logo (titles, step labels) — inline mentions in
 * running copy stay in body text so paragraphs remain readable.
 */
export const ReeentWordmark = ({ children }: { children: ReactNode }) => (
  <span className="font-reeent text-reeent font-extrabold tracking-[-0.02em] lowercase">
    {children}
  </span>
);

/**
 * Rich-text tag for messages that carry `<reeent>…</reeent>`, so every surface
 * brands the name the same way: `t.rich('key', reeentRichTags)`.
 */
export const reeentRichTags = {
  reeent: (chunks: ReactNode) => <ReeentWordmark>{chunks}</ReeentWordmark>,
};
