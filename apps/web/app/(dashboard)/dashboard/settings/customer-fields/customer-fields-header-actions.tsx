"use client";

import { LayoutTemplate, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";

/** The page's two ways in: a blank field (the usual one), or a ready-made set. */
export const CustomerFieldsHeaderActions = () => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { openPicker, setGalleryOpen } = useCustomerFieldsBuilder();

  return (
    // On a phone the pair takes the page's full width (the gutter is 1rem a side), so the
    // header puts it under the description instead of squeezing the text beside it.
    <div className="flex gap-2 max-sm:w-[calc(100vw-2rem)] max-sm:*:flex-1">
      <Button type="button" variant="outline" onClick={() => setGalleryOpen(true)}>
        <LayoutTemplate />
        {t("builder.templates.button")}
      </Button>
      <Button type="button" onClick={() => openPicker()}>
        <Plus />
        {t("field.add")}
      </Button>
    </div>
  );
};
