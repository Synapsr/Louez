"use client";

import { useId } from "react";

import { useTranslations } from "next-intl";

import { Checkbox, Label } from "@louez/ui";

interface CatalogAvailabilityFilterProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Lets visitors include unavailable products in the results. */
export const CatalogAvailabilityFilter = ({
  checked,
  onChange,
}: CatalogAvailabilityFilterProps) => {
  const t = useTranslations("storefront.catalog");
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5" data-slot="catalog-availability-filter">
      <div className="flex items-center gap-2.5">
        <Checkbox id={id} checked={checked} onCheckedChange={(next) => onChange(next === true)} />
        <Label htmlFor={id} className="text-sm font-normal">
          {t("showUnavailable")}
        </Label>
      </div>
    </div>
  );
};
