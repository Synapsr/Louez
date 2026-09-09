"use client";

import { useId } from "react";

import { useTranslations } from "next-intl";

import { Checkbox, Label } from "@louez/ui";

interface CatalogAvailabilityFilterProps {
  checked: boolean;
  /** Without dates there is nothing to check against, so the box is disabled. */
  hasPeriod: boolean;
  onChange: (checked: boolean) => void;
}

/** "Disponibles uniquement": hides what the browsed period cannot book. */
export const CatalogAvailabilityFilter = ({
  checked,
  hasPeriod,
  onChange,
}: CatalogAvailabilityFilterProps) => {
  const t = useTranslations("storefront.catalog");
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5" data-slot="catalog-availability-filter">
      <div className="flex items-center gap-2.5">
        <Checkbox
          id={id}
          checked={checked && hasPeriod}
          disabled={!hasPeriod}
          onCheckedChange={(next) => onChange(next === true)}
        />
        <Label htmlFor={id} className="text-sm font-normal">
          {t("availableOnly")}
        </Label>
      </div>
      {hasPeriod ? null : (
        <p className="pl-7 text-xs text-muted-foreground">{t("availableOnlyHint")}</p>
      )}
    </div>
  );
};
