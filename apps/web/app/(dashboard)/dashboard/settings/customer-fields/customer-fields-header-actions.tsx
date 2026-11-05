"use client";

import { Eye, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, DisabledControlsProvider } from "@louez/ui";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";

/** "Aperçu client" (what the checkout asks) and "Ajouter un champ" to the tab shown. */
export const CustomerFieldsHeaderActions = () => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { readOnly, setPreviewOpen, setPickerOpen } = useCustomerFieldsBuilder();

  return (
    // On a phone the pair takes the page's full width (the gutter is 1rem a side), so the
    // header puts it under the description instead of squeezing the text beside it.
    <div className="flex gap-2 max-sm:w-[calc(100vw-2rem)] max-sm:*:flex-1">
      {/* Looking changes nothing: members without `manage_settings` may too. */}
      <DisabledControlsProvider disabled={false}>
        <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
          <Eye />
          {t("builder.preview.open")}
        </Button>
      </DisabledControlsProvider>
      {!readOnly && (
        <Button type="button" onClick={() => setPickerOpen(true)}>
          <Plus />
          {t("field.add")}
        </Button>
      )}
    </div>
  );
};
