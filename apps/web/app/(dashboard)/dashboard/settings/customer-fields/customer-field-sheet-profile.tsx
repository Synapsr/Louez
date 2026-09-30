"use client";

import { useTranslations } from "next-intl";

import type { CustomerProfileFieldKey, CustomerProfileFieldSettings } from "@louez/types";
import { SheetPanel } from "@louez/ui";
import type { CustomerFormBuiltInItem } from "@louez/validations";

import { CustomerFieldLayoutGroup } from "./customer-field-layout-group";
import { CustomerFieldSheetHeader } from "./customer-field-sheet-header";
import { CUSTOMER_FIELD_TYPE_ICONS } from "./customer-field-type-icon";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { PROFILE_FIELD_TYPES } from "./customer-fields.constants";
import { CustomerProfileFieldSettingsBody } from "./customer-profile-field-settings-body";
import { useCustomerProfileFieldAutosave } from "./use-customer-profile-field-autosave";

interface CustomerFieldSheetProfileProps {
  item: CustomerFormBuiltInItem;
  field: CustomerProfileFieldKey;
  label: string;
  settings: CustomerProfileFieldSettings;
}

/**
 * A Louez profile field (birth date, origin, links): the same settings as a
 * store field, saved as they are made; it cannot be renamed or deleted.
 * Mounted per field.
 */
export const CustomerFieldSheetProfile = ({
  item,
  field,
  label,
  settings,
}: CustomerFieldSheetProfileProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { closeSheet, actions } = useCustomerFieldsBuilder();
  const autosave = useCustomerProfileFieldAutosave(field);

  return (
    <>
      <CustomerFieldSheetHeader
        title={label}
        kind={{
          icon: CUSTOMER_FIELD_TYPE_ICONS[PROFILE_FIELD_TYPES[field]],
          label: t("badges.louez"),
        }}
        status={autosave.status}
        onClose={closeSheet}
      />
      <SheetPanel className="p-4 sm:p-5">
        <CustomerProfileFieldSettingsBody
          field={field}
          label={label}
          settings={settings}
          layout={
            <CustomerFieldLayoutGroup
              width={item.width}
              fixed={item.fixedWidth}
              onChange={(width) => actions.setWidth("customer", item.key, width)}
            />
          }
          onChange={autosave.change}
          errorFor={autosave.errorFor}
        />
      </SheetPanel>
    </>
  );
};
