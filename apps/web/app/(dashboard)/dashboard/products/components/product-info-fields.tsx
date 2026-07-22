"use client";

import type { ChangeEvent } from "react";
import { useMemo, useState } from "react";

import { Info, Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  Label,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@louez/ui";

import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { getFieldError } from "@/hooks/form/form-context";

import type { Category, ProductFormComponentApi } from "../types";

const CREATE_CATEGORY_VALUE = "__create__";

interface CategoryComboboxItem {
  label: string;
  value: string;
  kind?: "create";
}

export interface ProductInfoFieldsProps {
  form: ProductFormComponentApi;
  categories: Category[];
  onCreateCategory: (name: string) => Promise<string | null>;
  isCreatingCategory: boolean;
  onNameInputChange?: (
    event: ChangeEvent<HTMLInputElement>,
    handleChange: (value: string) => void,
  ) => void;
}

export function ProductInfoFields({
  form,
  categories,
  onCreateCategory,
  isCreatingCategory,
  onNameInputChange,
}: ProductInfoFieldsProps) {
  const t = useTranslations("dashboard.products.form");
  const [categoryQuery, setCategoryQuery] = useState("");

  const categoryItems = useMemo<CategoryComboboxItem[]>(() => {
    const items: CategoryComboboxItem[] = categories.map((category) => ({
      label: category.name,
      value: category.id,
    }));
    const query = categoryQuery.trim();
    if (query && !items.some((item) => item.label.toLowerCase() === query.toLowerCase())) {
      items.push({ label: query, value: CREATE_CATEGORY_VALUE, kind: "create" });
    }
    return items;
  }, [categories, categoryQuery]);

  return (
    <div className="space-y-5">
      <div className="grid items-center gap-5 sm:grid-cols-2">
        <form.AppField name="name">
          {(field) => (
            <field.Input
              label={t("name")}
              placeholder={t("namePlaceholder")}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                if (onNameInputChange) {
                  onNameInputChange(event, field.handleChange);
                  return;
                }

                field.handleChange(event.target.value);
              }}
            />
          )}
        </form.AppField>

        <form.Field name="categoryId">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-1.5">
                {t("category")}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground inline-flex cursor-help transition-colors"
                          aria-label={t("categoryOptional")}
                        />
                      }
                    >
                      <Info className="h-3.5 w-3.5" />
                    </TooltipTrigger>
                    <TooltipContent>{t("categoryOptional")}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <Combobox
                items={categoryItems}
                value={
                  categoryItems.find(
                    (item) => item.kind !== "create" && item.value === field.state.value,
                  ) ?? null
                }
                onValueChange={async (item: CategoryComboboxItem | null) => {
                  if (!item) {
                    field.handleChange(null);
                    return;
                  }
                  if (item.kind === "create") {
                    const createdId = await onCreateCategory(item.label);
                    if (createdId) {
                      field.handleChange(createdId);
                      setCategoryQuery("");
                    }
                    return;
                  }
                  field.handleChange(item.value);
                }}
              >
                <ComboboxInput
                  showTrigger
                  showClear={Boolean(field.state.value)}
                  placeholder={t("categorySearchPlaceholder")}
                  disabled={isCreatingCategory}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setCategoryQuery(event.target.value)
                  }
                />
                <ComboboxPopup>
                  <ComboboxEmpty>{t("categoryNoResults")}</ComboboxEmpty>
                  <ComboboxList>
                    {(item: CategoryComboboxItem) =>
                      item.kind === "create" ? (
                        <ComboboxItem key={CREATE_CATEGORY_VALUE} value={item}>
                          <span className="text-primary flex items-center gap-1.5 font-medium">
                            {isCreatingCategory ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Plus className="h-3.5 w-3.5" />
                            )}
                            {t("categoryCreateOption", { name: item.label })}
                          </span>
                        </ComboboxItem>
                      ) : (
                        <ComboboxItem key={item.value} value={item}>
                          {item.label}
                        </ComboboxItem>
                      )
                    }
                  </ComboboxList>
                </ComboboxPopup>
              </Combobox>
              {field.state.meta.errors.length > 0 && (
                <p className="text-destructive text-sm font-medium">
                  {getFieldError(field.state.meta.errors[0])}
                </p>
              )}
            </div>
          )}
        </form.Field>
      </div>

      <form.Field name="description">
        {(field) => (
          <div className="space-y-2">
            <Label>{t("description")}</Label>
            <RichTextEditor
              value={field.state.value || ""}
              onChange={field.handleChange}
              placeholder={t("descriptionPlaceholder")}
            />
            <p className="text-muted-foreground text-xs">{t("descriptionHint")}</p>
            {field.state.meta.errors.length > 0 && (
              <p className="text-destructive text-sm font-medium">
                {getFieldError(field.state.meta.errors[0])}
              </p>
            )}
          </div>
        )}
      </form.Field>
    </div>
  );
}
