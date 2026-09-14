import {
  STORE_SOCIAL_NETWORKS,
  type StoreSocialLinks,
  type StoreSocialNetwork,
} from "@louez/types";

export interface StoreSocialLink {
  network: StoreSocialNetwork;
  /** Full URL of the profile, as typed in the dashboard. */
  url: string;
}

/**
 * The profiles a store filled in, in display order, blank entries dropped.
 * The footer renders them as icon links and the LocalBusiness schema lists
 * them as `sameAs`.
 */
export const resolveStoreSocialLinks = (
  social: StoreSocialLinks | null | undefined,
): StoreSocialLink[] =>
  STORE_SOCIAL_NETWORKS.flatMap((network) => {
    const url = social?.[network]?.trim();
    return url ? [{ network, url }] : [];
  });
