import { getTranslations } from "next-intl/server";

interface MarketplaceChannelBadgeProps {
  marketplaceUrl?: string;
}

/**
 * Sales-channel pill shown next to the logo when the visitor came through
 * the marketplace. Links back to it when the instance knows its URL.
 */
export const MarketplaceChannelBadge = async ({ marketplaceUrl }: MarketplaceChannelBadgeProps) => {
  const t = await getTranslations("storefront.marketplaceShell");
  const badge = (
    <span className="inline-flex h-7 items-center rounded-full border bg-muted px-3 text-xs font-semibold text-muted-foreground">
      {t("marketplaceName")}
    </span>
  );

  return marketplaceUrl ? (
    <a href={marketplaceUrl} className="inline-flex min-h-11 items-center">
      {badge}
    </a>
  ) : (
    badge
  );
};
