"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import type { CustomerFieldTarget } from "@louez/types";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxValue,
  Skeleton,
  useControlsDisabled,
} from "@louez/ui";

import { orpc } from "@/lib/orpc/react";

import { CustomerFieldTargetChipContent } from "./customer-field-target-chip-content";
import { CustomerFieldTargetOption } from "./customer-field-target-option";
import {
  type CustomerFieldTargetItem,
  buildTargetItems,
  selectTargetItems,
} from "./util.customer-field-online";

interface CustomerFieldTargetPickerProps {
  id: string;
  value: CustomerFieldTarget[];
  onChange: (targets: CustomerFieldTarget[]) => void;
  "aria-describedby"?: string;
}

/**
 * "Selon les produits": categories and products in one searchable list, the
 * picked ones as chips. A category covers every product in it, today's and
 * tomorrow's.
 */
export const CustomerFieldTargetPicker = ({
  id,
  value,
  onChange,
  "aria-describedby": ariaDescribedBy,
}: CustomerFieldTargetPickerProps) => {
  const t = useTranslations("dashboard.settings.customerFields.online");
  const { data: options } = useQuery(orpc.dashboard.customerFields.targetOptions.queryOptions());
  const readOnly = useControlsDisabled();

  if (!options) return <Skeleton className="h-9 w-full rounded-lg" />;

  const { categories, products } = buildTargetItems(options, value);
  const picked = selectTargetItems([...categories, ...products], value);

  // Base UI keeps the chips' remove buttons live on a disabled combobox: read-only shows plain chips.
  if (readOnly) {
    return (
      <ul
        aria-describedby={ariaDescribedBy}
        className="bg-background flex min-h-9 flex-wrap items-center gap-1 rounded-lg border p-1 opacity-64"
      >
        {picked.map((item) => (
          <li
            key={item.value}
            className="bg-accent text-accent-foreground flex h-6 items-center rounded-[calc(var(--radius-md)-1px)] px-2 text-sm font-medium sm:text-xs"
          >
            <CustomerFieldTargetChipContent item={item} />
          </li>
        ))}
      </ul>
    );
  }

  const groups = [
    { value: "categories", label: t("groups.categories"), items: categories },
    { value: "products", label: t("groups.products"), items: products },
  ].filter((group) => group.items.length > 0);

  return (
    <Combobox
      items={groups}
      multiple
      autoHighlight
      value={picked}
      isItemEqualToValue={(item: CustomerFieldTargetItem, selected: CustomerFieldTargetItem) =>
        item.value === selected.value
      }
      onValueChange={(next: CustomerFieldTargetItem[]) => onChange(next.map((item) => item.target))}
    >
      <ComboboxChips showTrigger>
        <ComboboxValue>
          {(chosen: CustomerFieldTargetItem[]) => (
            <>
              {chosen.map((item) => (
                <ComboboxChip key={item.value} aria-label={item.label}>
                  <CustomerFieldTargetChipContent item={item} />
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                id={id}
                aria-describedby={ariaDescribedBy}
                className="w-24"
                placeholder={chosen.length === 0 ? t("targetsPlaceholder") : undefined}
                onKeyDown={(event) => {
                  // Enter picks the highlighted entry; it must not submit the dialog's form.
                  if (event.key === "Enter") event.preventDefault();
                }}
              />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxPopup>
        <ComboboxEmpty>{t("targetsEmpty")}</ComboboxEmpty>
        <ComboboxList>
          {(group: (typeof groups)[number]) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>
              <ComboboxCollection>
                {(item: CustomerFieldTargetItem) => (
                  // `*:min-w-0`: a long product name truncates instead of widening every row.
                  <ComboboxItem key={item.value} value={item} className="*:min-w-0">
                    <CustomerFieldTargetOption item={item} />
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
};
