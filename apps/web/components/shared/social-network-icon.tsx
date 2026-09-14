import {
  FacebookIcon,
  GlobeIcon,
  InstagramIcon,
  LinkedinIcon,
  type LucideIcon,
  YoutubeIcon,
} from "lucide-react";

import type { StoreSocialNetwork } from "@louez/types";
import { cn } from "@louez/utils";

/** Display names of the networks; brand names read the same in every locale. */
export const SOCIAL_NETWORK_LABELS: Record<StoreSocialNetwork, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
  website: "Site web",
};

type SocialNetworkGlyph = { kind: "lucide"; Icon: LucideIcon } | { kind: "path"; d: string };

/**
 * Lucide where it has the brand; TikTok and X as their own 24×24 outlines
 * (simple-icons paths, CC0), filled so they weigh the same as the strokes.
 */
const SOCIAL_NETWORK_GLYPHS: Record<StoreSocialNetwork, SocialNetworkGlyph> = {
  instagram: { kind: "lucide", Icon: InstagramIcon },
  facebook: { kind: "lucide", Icon: FacebookIcon },
  tiktok: {
    kind: "path",
    d: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  },
  youtube: { kind: "lucide", Icon: YoutubeIcon },
  linkedin: { kind: "lucide", Icon: LinkedinIcon },
  x: {
    kind: "path",
    d: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  },
  website: { kind: "lucide", Icon: GlobeIcon },
};

interface SocialNetworkIconProps {
  network: StoreSocialNetwork;
  className?: string;
}

/**
 * The glyph of a social network, decorative: the link around it carries the
 * name. Sized like a lucide icon (24px unless the class says otherwise) so
 * the two kinds line up in a row.
 */
export const SocialNetworkIcon = ({ network, className }: SocialNetworkIconProps) => {
  const glyph = SOCIAL_NETWORK_GLYPHS[network];

  if (glyph.kind === "lucide") {
    return <glyph.Icon aria-hidden className={className} />;
  }

  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="currentColor"
      className={cn("shrink-0", className)}
    >
      <path d={glyph.d} />
    </svg>
  );
};
