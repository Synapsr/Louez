"use client";

import { useId } from "react";

import { useTranslations } from "next-intl";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  Label,
} from "@louez/ui";

interface PreviewProductOption {
  value: string;
  label: string;
}

interface CustomerFieldsPreviewProductPickerProps {
  products: { id: string; name: string }[];
  /** Null for "Tous les produits". */
  value: string | null;
  onChange: (productId: string | null) => void;
}

/** Sentinel of "Tous les produits": no product id is empty. */
const ALL_PRODUCTS = "";

/** "Aperçu pour": a searchable product list, "Tous les produits" first. */
export const CustomerFieldsPreviewProductPicker = ({
  products,
  value,
  onChange,
}: CustomerFieldsPreviewProductPickerProps) => {
  const t = useTranslations("dashboard.settings.customerFields.preview.client");
  const tCalendar = useTranslations("dashboard.calendar");
  const inputId = useId();
  const options: PreviewProductOption[] = [
    { value: ALL_PRODUCTS, label: tCalendar("allProducts") },
    ...products.map((product) => ({ value: product.id, label: product.name })),
  ];
  const selected = options.find((option) => option.value === (value ?? ALL_PRODUCTS)) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>{t("previewFor")}</Label>
      <Combobox
        items={options}
        autoHighlight
        value={selected}
        onValueChange={(next: PreviewProductOption | null) =>
          onChange(next && next.value !== ALL_PRODUCTS ? next.value : null)
        }
      >
        <ComboboxInput id={inputId} showTrigger size="sm" placeholder={tCalendar("allProducts")} />
        <ComboboxPopup>
          <ComboboxEmpty>{t("noProduct")}</ComboboxEmpty>
          <ComboboxList>
            {(option: PreviewProductOption) => (
              <ComboboxItem key={option.value} value={option}>
                {option.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  );
};
