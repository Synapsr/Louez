"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { CUSTOMER_SOCIAL_NETWORKS, type CustomerSocialNetwork } from "@louez/types";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from "@louez/ui";
import {
  formatCustomerSocialLink,
  getCustomerSocialLinkUrl,
  normalizeCustomerSocialLink,
} from "@louez/utils";

import { SOCIAL_NETWORK_LABELS, SocialNetworkIcon } from "@/components/shared/social-network-icon";

/** Links being edited: a network is present as soon as its row is shown, even while still blank. */
export type SocialLinksDraft = Partial<Record<CustomerSocialNetwork, string>>;

interface SocialLinksInputProps {
  value: SocialLinksDraft;
  onChange: (value: SocialLinksDraft) => void;
}

const PLACEHOLDER_KEY: Partial<Record<CustomerSocialNetwork, string>> = {
  website: "placeholderWebsite",
  whatsapp: "placeholderWhatsapp",
};

/**
 * Only the links a customer has are shown; the others wait behind "Add a
 * link". A row takes a handle or a pasted profile URL and settles on the
 * stored form when the field is left.
 */
export const SocialLinksInput = ({ value, onChange }: SocialLinksInputProps) => {
  const t = useTranslations("dashboard.customers.social");

  const added = CUSTOMER_SOCIAL_NETWORKS.filter((network) => value[network] !== undefined);
  const remaining = CUSTOMER_SOCIAL_NETWORKS.filter((network) => value[network] === undefined);

  const setLink = (network: CustomerSocialNetwork, link: string) =>
    onChange({ ...value, [network]: link });

  const removeLink = (network: CustomerSocialNetwork) =>
    onChange(
      Object.fromEntries(
        CUSTOMER_SOCIAL_NETWORKS.flatMap((key) => {
          const link = value[key];
          return key === network || link === undefined ? [] : [[key, link]];
        }),
      ),
    );

  return (
    <div className="flex flex-col gap-2">
      {added.map((network) => {
        const link = value[network] ?? "";
        const stored = normalizeCustomerSocialLink(network, link);
        return (
          <div key={network} className="flex items-start gap-2">
            <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
              <SocialNetworkIcon network={network} className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <Input
                aria-label={SOCIAL_NETWORK_LABELS[network]}
                value={link}
                placeholder={t(PLACEHOLDER_KEY[network] ?? "placeholderHandle")}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setLink(network, event.target.value)}
                onBlur={() => stored && setLink(network, stored)}
              />
              {stored && (
                <a
                  href={getCustomerSocialLinkUrl(network, stored)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground mt-1 inline-block truncate text-xs underline-offset-2 hover:underline"
                >
                  {formatCustomerSocialLink(network, stored)}
                </a>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("remove", { network: SOCIAL_NETWORK_LABELS[network] })}
              onClick={() => removeLink(network)}
            >
              <X className="size-4" />
            </Button>
          </div>
        );
      })}

      {remaining.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button type="button" variant="outline" size="sm" className="self-start" />}
          >
            <Plus className="size-4" />
            {t("add")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {remaining.map((network) => (
              <DropdownMenuItem key={network} onClick={() => setLink(network, "")}>
                <SocialNetworkIcon network={network} className="size-4" />
                {SOCIAL_NETWORK_LABELS[network]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};
