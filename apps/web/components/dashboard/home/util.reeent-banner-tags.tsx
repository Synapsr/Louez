import type { ReactNode } from "react";

import { ReeentWordmark } from "@/components/shared/reeent-wordmark";

/**
 * Rich-text tags of the reeent banners' sentences: `<b>` is the lead that
 * reads as a title, `<em>` the advantage in reeent's orange, `<reeent>` the
 * wordmark — a link to reeent when there is one to go to.
 */
export const reeentBannerTags = (reeentUrl: string | null) => ({
  b: (chunks: ReactNode) => <b className="text-foreground font-bold">{chunks}</b>,
  em: (chunks: ReactNode) => (
    <em className="text-reeent-ink font-bold whitespace-nowrap not-italic">{chunks}</em>
  ),
  reeent: (chunks: ReactNode) =>
    reeentUrl ? (
      <a
        href={reeentUrl}
        target="_blank"
        rel="noreferrer"
        className="focus-visible:ring-reeent-ink rounded-sm underline-offset-3 hover:underline focus-visible:ring-2 focus-visible:outline-none [&>span]:text-reeent-ink"
      >
        <ReeentWordmark>{chunks}</ReeentWordmark>
      </a>
    ) : (
      <span className="[&>span]:text-reeent-ink">
        <ReeentWordmark>{chunks}</ReeentWordmark>
      </span>
    ),
});
