"use client";

import { useRef, useState } from "react";

import { Sheet, SheetPopup } from "@louez/ui";
import { isCustomerProfileFieldKey } from "@louez/validations";

import { CustomerFieldSheetCustom } from "./customer-field-sheet-custom";
import { CustomerFieldSheetDraft } from "./customer-field-sheet-draft";
import { CustomerFieldSheetLocked } from "./customer-field-sheet-locked";
import { CustomerFieldSheetProfile } from "./customer-field-sheet-profile";
import { type BuilderSelection, useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { DRAFT_LABEL_INPUT_ID } from "./customer-fields.constants";
import { useCustomerFormItemLabel } from "./use-customer-form-item-label";

/**
 * The settings of the item clicked, or of the field being created, in a
 * Sheet on the right (full screen on a phone). It keeps showing its item
 * while it slides away, then lets go of it.
 */
export const CustomerFieldSheet = () => {
  const { selection, closeSheet, items, profileSettings } = useCustomerFieldsBuilder();
  const labelOf = useCustomerFormItemLabel();
  const [shown, setShown] = useState<BuilderSelection>(selection);
  const popupRef = useRef<HTMLDivElement>(null);
  if (selection !== null && selection !== shown) setShown(selection);
  const current = selection ?? shown;

  const renderContent = () => {
    if (current === null) return null;
    if (current.kind === "draft") return <CustomerFieldSheetDraft key={current.key} />;
    const item = items[current.scope].find((entry) => entry.key === current.key);
    if (!item) return null;
    if (item.kind === "custom") {
      return <CustomerFieldSheetCustom key={item.key} scope={current.scope} item={item} />;
    }
    const label = labelOf(item);
    if (!item.locked && isCustomerProfileFieldKey(item.key) && profileSettings) {
      return (
        <CustomerFieldSheetProfile
          key={item.key}
          item={item}
          field={item.key}
          label={label}
          settings={profileSettings[item.key]}
        />
      );
    }
    return <CustomerFieldSheetLocked key={item.key} item={item} label={label} />;
  };

  return (
    <Sheet
      open={selection !== null}
      onOpenChange={(open) => !open && closeSheet()}
      onOpenChangeComplete={(open) => !open && setShown(null)}
    >
      <SheetPopup
        ref={popupRef}
        side="right"
        showCloseButton={false}
        className="max-sm:w-full max-sm:max-w-none sm:max-w-md"
        // A field being created opens on its name; a saved one on the Sheet itself (Tab then
        // walks its settings from the top).
        initialFocus={() =>
          current?.kind === "draft"
            ? document.getElementById(DRAFT_LABEL_INPUT_ID)
            : popupRef.current
        }
      >
        {renderContent()}
      </SheetPopup>
    </Sheet>
  );
};
