"use client";

import { useTranslations } from "next-intl";

import { InputQuantity } from "@louez/ui";

/** Beyond this a group books through the store, not the catalog. */
const MAX_QUANTITY = 99;

interface CatalogQuantityFilterProps {
  /** Units the visitor needs; null is "one", which filters nothing. */
  value: number | null;
  onChange: (quantity: number | null) => void;
}

/**
 * "Il me faut 4 vélos": keeps the products the fleet holds that many of,
 * and, once dates are known, that the period can still book that many of.
 * One is the default and writes nothing to the URL.
 */
export const CatalogQuantityFilter = ({ value, onChange }: CatalogQuantityFilterProps) => {
  const t = useTranslations("storefront.catalog");

  return (
    <div className="flex flex-col items-start gap-2" data-slot="catalog-quantity-filter">
      <span className="text-sm">{t("quantityLabel")}</span>
      <InputQuantity
        value={value ?? 1}
        min={1}
        max={MAX_QUANTITY}
        onChange={(next) => onChange(next >= 2 ? next : null)}
        ariaLabel={t("quantityLabel")}
      />
    </div>
  );
};
