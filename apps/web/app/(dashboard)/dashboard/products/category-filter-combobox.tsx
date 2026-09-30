"use client";

import { useState } from "react";

import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@louez/ui";
import { cn } from "@louez/utils";

export interface CategoryFilterOption {
  id: string;
  name: string;
  productCount?: number;
}

interface CategoryFilterComboboxProps {
  categories: CategoryFilterOption[];
  isLoading: boolean;
  autoFocus?: boolean;
  selectedCategoryIds: string[];
  onChange: (categoryIds: string[]) => void;
}

export const CategoryFilterCombobox = ({
  categories,
  isLoading,
  autoFocus = true,
  selectedCategoryIds,
  onChange,
}: CategoryFilterComboboxProps) => {
  const t = useTranslations("dashboard.products");
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedIds = new Set(selectedCategoryIds);
  const filteredCategories = categories.filter((category) =>
    category.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  const toggleCategory = (categoryId: string) => {
    const next = new Set(selectedIds);
    if (next.has(categoryId)) {
      next.delete(categoryId);
    } else {
      next.add(categoryId);
    }

    onChange(categories.filter((category) => next.has(category.id)).map((category) => category.id));
  };

  const selectedCategories = categories.filter((category) => selectedIds.has(category.id));
  const triggerLabel =
    selectedIds.size === 0
      ? t("allCategories")
      : selectedCategories.length === 1
        ? selectedCategories[0].name
        : t("categoriesSelected", { count: selectedIds.size });

  return (
    <Popover modal={autoFocus ? undefined : false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-demo-target="products-category-filter"
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={t("filterByCategory")}
            disabled={isLoading && categories.length === 0}
            className="group w-full justify-between sm:w-50 [&>span]:min-w-0 [&>span]:first:w-full"
          />
        }
      >
        <span className="flex-1 truncate text-start">{triggerLabel}</span>
        <ChevronsUpDown
          data-slot="icon"
          className="size-4 shrink-0 opacity-70 transition-opacity group-hover:opacity-100"
        />
      </PopoverTrigger>
      <PopoverContent initialFocus={autoFocus ? undefined : false} finalFocus={autoFocus ? undefined : false} align="start" className="w-72 p-0 pt-1 *:p-0">
        <Command open items={filteredCategories} filter={null}>
          <CommandInput
            autoFocus={autoFocus}
            placeholder={t("searchCategories")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <CommandEmpty>{t("noCategoriesFound")}</CommandEmpty>
          <CommandList className="max-h-80 not-empty:pt-0">
            <CommandGroup>
              {filteredCategories.map((category) => {
                const isSelected = selectedIds.has(category.id);

                return (
                  <CommandItem
                    key={category.id}
                    data-product-category={category.id}
                    value={category.id}
                    onClick={() => toggleCategory(category.id)}
                    className="flex items-center gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate">{category.name}</span>
                    {category.productCount !== undefined && (
                      <Badge variant="expired" className="tabular-nums">
                        {category.productCount}
                      </Badge>
                    )}
                    <Check className={cn("size-4 shrink-0", !isSelected && "opacity-0")} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {selectedIds.size > 0 && (
          <div className="border-t p-1">
            <Button data-demo-target="products-clear-categories" variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>
              {t("allCategories")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
