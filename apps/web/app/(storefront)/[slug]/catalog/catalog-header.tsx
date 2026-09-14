"use client";

import { useTranslations } from "next-intl";

import { SectionHeader } from "@/components/storefront/ui/section-header";

interface CatalogHeaderProps {
  title: string;
  /** Products matching the filters; "N produits", never "disponibles" without dates. */
  count: number;
}

/** Page title of the catalog: the category name or "Catalogue", with the product count. */
export const CatalogHeader = ({ title, count }: CatalogHeaderProps) => {
  const t = useTranslations("storefront.availability");

  return (
    <SectionHeader
      level="h1"
      title={title}
      description={t("productCountPlural", { count })}
      className="mb-0 sm:mb-0"
    />
  );
};
