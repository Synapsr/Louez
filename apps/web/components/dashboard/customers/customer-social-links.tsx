import type { CustomerSocialLinks as CustomerSocialLinksValue } from "@louez/types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@louez/ui";
import {
  formatCustomerSocialLink,
  getCustomerSocialLinkUrl,
  resolveCustomerSocialLinks,
} from "@louez/utils";

import { SOCIAL_NETWORK_LABELS, SocialNetworkIcon } from "@/components/shared/social-network-icon";

interface CustomerSocialLinksProps {
  links: CustomerSocialLinksValue | null | undefined;
  /** Accessible name of a tile, e.g. "Ouvrir Instagram". */
  getOpenLabel: (network: string) => string;
}

/** A customer's profiles as a row of icon tiles; the handle reads in the tooltip. */
export const CustomerSocialLinks = ({ links, getOpenLabel }: CustomerSocialLinksProps) => {
  const entries = resolveCustomerSocialLinks(links);
  if (entries.length === 0) return null;

  return (
    <TooltipProvider>
      <ul className="flex flex-wrap gap-2">
        {entries.map(({ network, value }) => (
          <li key={network}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    href={getCustomerSocialLinkUrl(network, value)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={getOpenLabel(SOCIAL_NETWORK_LABELS[network])}
                    className="bg-muted text-muted-foreground hover:text-foreground hover:bg-accent flex size-9 items-center justify-center rounded-lg transition-colors"
                  />
                }
              >
                <SocialNetworkIcon network={network} className="size-4" />
              </TooltipTrigger>
              <TooltipContent>{formatCustomerSocialLink(network, value)}</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </TooltipProvider>
  );
};
