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
 * The inspector where the canvas leaves no room beside it: a sheet from the
 * right, the whole screen on a phone. Closing it closes the selection.
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
        // A field being created opens on its label; a saved one on the sheet itself.
        initialFocus={() =>
          selection?.kind === "draft" ? document.getElementById(DRAFT_LABEL_INPUT_ID) : true
        }
      >
        {/* The header names the field; the dialog still needs a name of its own. */}
        <SheetTitle className="sr-only">{t("label")}</SheetTitle>
        <CustomerFieldInspector />
      </SheetPopup>
    </Sheet>
  );
};
