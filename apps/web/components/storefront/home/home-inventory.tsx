import { getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";
import { PackageIcon } from "@louez/ui/icons";

import { CategoryBrowseGrid } from "@/components/storefront/category-browse-grid";
import { HomeProductGrid } from "@/components/storefront/home/home-product-grid";
import { EmptyState } from "@/components/storefront/ui/empty-state";
import { HomeInventoryView } from "@/components/storefront/home/home-inventory-view";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import type { HomeInventory as HomeInventoryData } from "@/lib/storefront/home.queries";

interface HomeInventoryProps {
  inventory: HomeInventoryData;
}

/**
 * What the store rents, right after the hero: category tiles linking into
 * the catalog in "categories" mode, the first eight products otherwise.
 */
export const HomeInventory = async ({ inventory }: HomeInventoryProps) => {
  const t = await getTranslations("storefront");

  return (
    <HomeInventoryView kind={inventory.kind}>
      {inventory.kind === "categories" ? (
        <CategoryBrowseGrid
          entries={inventory.entries}
          isAvailabilityLoading={false}
          showTotalsOnly
          showTitle={false}
        />
      ) : inventory.products.length > 0 ? (
        <HomeProductGrid products={inventory.products} />
      ) : (
        <EmptyState
          icon={<PackageIcon />}
          title={t("home.noProducts")}
          action={
            <Button variant="outline" render={<StorefrontLink href="/catalog" />}>
              {t("hero.cta")}
            </Button>
          }
          tone="card"
        />
      )}
    </HomeInventoryView>
  );
};
