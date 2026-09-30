"use client";

import { useTranslations } from "next-intl";

import { Sheet, SheetPopup, SheetTitle } from "@louez/ui";

import { CustomerFieldInspector } from "./customer-field-inspector";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { DRAFT_LABEL_INPUT_ID } from "./customer-fields.constants";

interface CustomerFieldInspectorSheetProps {
  open: boolean;
}

/**
 * The inspector where the screen leaves no room beside the form (a phone): it
 * covers the page, so it is modal. Closing it closes the selection.
 */
export const CustomerFieldInspectorSheet = ({ open }: CustomerFieldInspectorSheetProps) => {
  const t = useTranslations("dashboard.settings.customerFields.builder.inspector");
  const { selection, clearSelection } = useCustomerFieldsBuilder();

  return (
    <Sheet open={open} onOpenChange={(next) => !next && clearSelection()}>
      <SheetPopup
        side="right"
        showCloseButton={false}
        className="max-sm:w-full max-sm:max-w-none sm:max-w-md"
        data-field-inspector=""
        // A field being created opens on its label; a saved one on the sheet itself.
        initialFocus={() =>
          selection?.kind === "draft" ? document.getElementById(DRAFT_LABEL_INPUT_ID) : true
        }
      >
        {/* The header names the field; the dialog still needs a name of its own. */}
        <SheetTitle className="sr-only">{t("label")}</SheetTitle>
        <CustomerFieldInspector selection={selection} />
      </SheetPopup>
    </Sheet>
  );
};
