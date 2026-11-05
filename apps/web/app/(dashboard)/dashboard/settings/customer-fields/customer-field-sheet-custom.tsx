"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldScope } from "@louez/types";
import { SheetPanel } from "@louez/ui";
import type { CustomerFormCustomItem } from "@louez/validations";

import { CustomerFieldLayoutGroup } from "./customer-field-layout-group";
import { CustomerFieldSettingsBody } from "./customer-field-settings-body";
import { CustomerFieldSheetHeader } from "./customer-field-sheet-header";
import { CustomerFieldSheetMenu } from "./customer-field-sheet-menu";
import { CUSTOMER_FIELD_TYPE_ICONS } from "./customer-field-type-icon";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { useCustomerFieldAutosave } from "./use-customer-field-autosave";
import { type CustomerFieldWithUsage, toSettingsValues } from "./util.customer-fields-builder";

interface CustomerFieldSheetCustomProps {
  scope: CustomerFieldScope;
  item: CustomerFormCustomItem<CustomerFieldWithUsage>;
}

/** One of the store's fields: every change is saved as it is made. Mounted per field. */
export const CustomerFieldSheetCustom = ({ scope, item }: CustomerFieldSheetCustomProps) => {
  const t = useTranslations("dashboard.settings.customerFields.dialog.types");
  const { readOnly, closeSheet, actions } = useCustomerFieldsBuilder();
  const field = item.definition;
  const autosave = useCustomerFieldAutosave(field);

  return (
    <>
      <CustomerFieldSheetHeader
        title={field.label}
        kind={{ icon: CUSTOMER_FIELD_TYPE_ICONS[field.type], label: t(field.type) }}
        status={autosave.status}
        menu={readOnly ? null : <CustomerFieldSheetMenu fieldId={field.id} label={field.label} />}
        onClose={closeSheet}
      />
      <SheetPanel className="p-4 sm:p-5">
        <CustomerFieldSettingsBody
          idPrefix={`sheet-${field.id}`}
          scope={scope}
          type={field.type}
          values={toSettingsValues(field)}
          shown={field.isActive}
          textMode="commit"
          layout={
            <CustomerFieldLayoutGroup
              width={item.width}
              fixed={false}
              onChange={(width) => actions.setWidth(scope, item.key, width)}
            />
          }
          onChange={autosave.change}
          errorFor={autosave.errorFor}
        />
      </SheetPanel>
    </>
  );
};
