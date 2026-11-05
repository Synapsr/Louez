"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import { SheetPanel } from "@louez/ui";
import type { CustomerFormBuiltInItem } from "@louez/validations";

import { CustomerFieldLayoutGroup } from "./customer-field-layout-group";
import { CustomerFieldSheetHeader } from "./customer-field-sheet-header";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";

interface CustomerFieldSheetLockedProps {
  item: CustomerFormBuiltInItem;
  label: string;
}

/** A field every customer has (names, contact, company): only its place in the form can change. */
export const CustomerFieldSheetLocked = ({ item, label }: CustomerFieldSheetLockedProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { closeSheet, actions } = useCustomerFieldsBuilder();

  return (
    <>
      <CustomerFieldSheetHeader
        title={label}
        kind={{ icon: Lock, label: t("badges.louez") }}
        onClose={closeSheet}
      />
      <SheetPanel className="p-4 sm:p-5">
        <div className="flex flex-col divide-y">
          <p className="text-muted-foreground flex items-start gap-2 pb-5 text-sm">
            <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t("builder.locked.sheetNote")}
          </p>
          <CustomerFieldLayoutGroup
            width={item.width}
            fixed={item.fixedWidth}
            onChange={(width) => actions.setWidth("customer", item.key, width)}
          />
        </div>
      </SheetPanel>
    </>
  );
};
