"use client";

import { PackageIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { EmptyState } from "@/components/storefront/ui/empty-state";

interface CatalogEmptyStateProps {
  /** The search term that found nothing, if any. */
  search: string;
  /** Clears category and search: back to every product. */
  onShowAll: () => void;
}

/** No product for these filters: one line and one way out, the whole catalog. */
export const CatalogEmptyState = ({ search, onShowAll }: CatalogEmptyStateProps) => {
  const t = useTranslations("storefront.catalog");

  return (
    <EmptyState
      tone="card"
      icon={<PackageIcon />}
      title={search ? t("noProductsFor", { search }) : t("noProducts")}
      description={t("noProductsDescription")}
      action={
        <Button variant="outline" className="h-12 lg:h-10" onClick={onShowAll}>
          {t("allProducts")}
        </Button>
      }
    />
  );
};
