import { getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";
import { PackageIcon } from "@louez/ui/icons";

import { CategoryBrowseGrid } from "@/components/storefront/category-browse-grid";
import { HomeProductGrid } from "@/components/storefront/home/home-product-grid";
import { EmptyState } from "@/components/storefront/ui/empty-state";
import { SectionHeader } from "@/components/storefront/ui/section-header";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
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
  const isCategories = inventory.kind === "categories";

  return (
    <StorefrontSection aria-labelledby="home-inventory-title">
      <SectionHeader
        id="home-inventory-title"
        title={isCategories ? t("availability.categoryBrowse.title") : t("home.ourProducts")}
        action={
          <StorefrontLink
            href="/catalog"
            className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline"
          >
            {t("home.viewAll")}
          </StorefrontLink>
        }
      />

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
    </StorefrontSection>
  );
};
