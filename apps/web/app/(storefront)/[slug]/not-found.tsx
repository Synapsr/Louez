import { PackageSearchIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";

import { EmptyState } from "@/components/storefront/ui/empty-state";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";

/**
 * Every 404 under a store: a draft or archived product, an unknown
 * reservation, a mistyped URL. Rendered inside the store layout so the
 * visitor keeps the header, the theme and a way back into the catalogue,
 * while the response stays a real 404 so stale product URLs drop out of
 * search indexes. The copy is deliberately generic: a draft product must
 * not leak its name here.
 */
const StorefrontNotFound = async () => {
  const t = await getTranslations("storefront.notFound");

  return (
    <StorefrontSection width="narrow">
      <EmptyState
        icon={<PackageSearchIcon />}
        title={t("title")}
        description={t("description")}
        action={
          <Button
            size="xl"
            className="h-12 w-full lg:h-10 sm:w-auto"
            render={<StorefrontLink href="/catalog" />}
          >
            {t("browseCatalog")}
          </Button>
        }
      />
    </StorefrontSection>
  );
};

export default StorefrontNotFound;
