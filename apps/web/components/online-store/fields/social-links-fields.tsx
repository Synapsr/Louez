"use client";

import { STORE_SOCIAL_NETWORKS, type StoreSocialNetwork } from "@louez/types";

import { SOCIAL_NETWORK_LABELS, SocialNetworkIcon } from "@/components/shared/social-network-icon";
import { withForm } from "@/hooks/form/form";

import { onlineStoreFormOptions } from "../util.online-store-form";

const PLACEHOLDERS: Partial<Record<StoreSocialNetwork, string>> = {
  instagram: "https://instagram.com/…",
  facebook: "https://facebook.com/…",
  tiktok: "https://tiktok.com/@…",
  youtube: "https://youtube.com/@…",
  linkedin: "https://linkedin.com/company/…",
  x: "https://x.com/…",
};

/** The website has its own field in the identity section; the rest are the social profiles. */
const SOCIAL_PROFILES = STORE_SOCIAL_NETWORKS.filter((network) => network !== "website");

/** One URL per network, named by its icon; an empty field means the network is not shown. */
export const SocialLinksFields = withForm({
  ...onlineStoreFormOptions,
  render: ({ form }) => (
    <div className="flex flex-col gap-2">
      {SOCIAL_PROFILES.map((network) => (
        <form.AppField key={network} name={`contact.social.${network}`}>
          {(field) => (
            <div className="flex items-start gap-2">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              >
                <SocialNetworkIcon network={network} className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <field.Input
                  aria-label={SOCIAL_NETWORK_LABELS[network]}
                  placeholder={PLACEHOLDERS[network]}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
          )}
        </form.AppField>
      ))}
    </div>
  ),
});
