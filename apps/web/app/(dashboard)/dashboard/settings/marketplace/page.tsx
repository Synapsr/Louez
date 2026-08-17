import { redirect } from "next/navigation";

import { asc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { getMarketplaceChannelState } from "@louez/api/services";
import { categories, db } from "@louez/db";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { fetchMarketplaceMatches, inferMarketplaceMatchCity } from "@/lib/marketplace-match";
import { fetchMarketplaceTaxonomy } from "@/lib/marketplace-taxonomy";
import { getCurrentStore } from "@/lib/store-context";
import { getStorefrontUrl } from "@/lib/storefront-url";

import { MarketplaceChannelForm } from "./marketplace-channel-form";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function MarketplaceChannelSettingsPage() {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const t = await getTranslations("dashboard.settings.salesChannels");

  const channelState = await getMarketplaceChannelState({ storeId: store.id });
  const [storeCategories, taxonomy, matchCandidates] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.storeId, store.id))
      .orderBy(asc(categories.order), asc(categories.name)),
    fetchMarketplaceTaxonomy(),
    channelState.channel?.enabledByOwner
      ? fetchMarketplaceMatches({
          name: store.name,
          latitude: store.latitude,
          longitude: store.longitude,
          city: inferMarketplaceMatchCity(store.address),
        })
      : Promise.resolve(null),
  ]);

  return (
    <SettingsPageShell title={t("title")} description={t("description")} width="wide">
      <MarketplaceChannelForm
        channelState={channelState}
        matchCandidates={matchCandidates?.slice(0, 3) ?? null}
        storeCategories={storeCategories}
        storefrontUrl={getStorefrontUrl(store.slug, "/")}
        taxonomy={taxonomy}
      />
    </SettingsPageShell>
  );
}
