"use client";

import { useId } from "react";

import { Checkbox, Label } from "@louez/ui";

import type { CatalogAttributeAxis } from "@/lib/storefront/catalog.queries";

interface CatalogAttributeFilterProps {
  axis: CatalogAttributeAxis;
  /** Values picked on this axis. */
  selected: readonly string[];
  onToggle: (value: string, selected: boolean) => void;
}

/**
 * One variant axis of the sidebar (Taille, Couleur…): a checkbox per value
 * the store's units carry. Several values on one axis widen the match;
 * several axes narrow it.
 */
export const CatalogAttributeFilter = ({
  axis,
  selected,
  onToggle,
}: CatalogAttributeFilterProps) => {
  const idPrefix = useId();

  return (
    <ul className="flex flex-col gap-1" data-slot="catalog-attribute-filter">
      {axis.values.map((value) => {
        const id = `${idPrefix}-${value}`;
        const isSelected = selected.includes(value);
        return (
          <li key={value} className="flex min-h-9 items-center gap-2.5 lg:min-h-8">
            <Checkbox
              id={id}
              checked={isSelected}
              onCheckedChange={(checked) => onToggle(value, checked === true)}
            />
            <Label htmlFor={id} className="min-w-0 flex-1 truncate text-sm font-normal">
              {value}
            </Label>
          </li>
        );
      })}
    </ul>
  );
};
