import {
  FacebookIcon,
  GlobeIcon,
  InstagramIcon,
  LinkedinIcon,
  type LucideIcon,
  YoutubeIcon,
} from "lucide-react";

import type { CustomerSocialNetwork } from "@louez/types";
import { cn } from "@louez/utils";

/** Display names of the networks; brand names read the same in every locale. */
export const SOCIAL_NETWORK_LABELS: Record<CustomerSocialNetwork, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
  website: "Site web",
  whatsapp: "WhatsApp",
};

type SocialNetworkGlyph = { kind: "lucide"; Icon: LucideIcon } | { kind: "path"; d: string };

/**
 * Lucide where it has the brand; TikTok and X as their own 24×24 outlines
 * (simple-icons paths, CC0), filled so they weigh the same as the strokes.
 */
const SOCIAL_NETWORK_GLYPHS: Record<CustomerSocialNetwork, SocialNetworkGlyph> = {
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
  // Customer records only: a store lists its public profiles, not a phone line.
  whatsapp: {
    kind: "path",
    d: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z",
  },
};

interface SocialNetworkIconProps {
  network: CustomerSocialNetwork;
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
