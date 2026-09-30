"use client";

import { useTranslations } from "next-intl";

import { CustomerFieldInspectorHeader } from "./customer-field-inspector-header";
import { CustomerFieldMenu } from "./customer-field-menu";
import { CustomerFieldSettingsBody } from "./customer-field-settings-body";
import { type InspectorFocus, useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { useCustomerFieldAutosave } from "./use-customer-field-autosave";
import { useInspectorOnlineScroll } from "./use-inspector-online-scroll";
import { type CustomerFieldWithUsage, toSettingsValues } from "./util.customer-fields-builder";

interface CustomerFieldInspectorFieldProps {
  field: CustomerFieldWithUsage;
  focus: InspectorFocus;
  /** Changes on every click on the field, so the same focus scrolls again. */
  request: number;
}

/** A saved store field: every change is saved as it is made, no Save button. Mounted per field. */
export const CustomerFieldInspectorField = ({
  field,
  focus,
  request,
}: CustomerFieldInspectorFieldProps) => {
  const t = useTranslations("dashboard.settings.customerFields.dialog.types");
  const { readOnly, clearSelection } = useCustomerFieldsBuilder();
  const autosave = useCustomerFieldAutosave(field);
  const { bodyRef, onlineRef } = useInspectorOnlineScroll(focus, request);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CustomerFieldInspectorHeader
        title={field.label}
        type={field.type}
        typeLabel={t(field.type)}
        scope={field.scope}
        status={autosave.status}
        menu={readOnly ? null : <CustomerFieldMenu field={field} />}
        onClose={clearSelection}
      />
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
        <CustomerFieldSettingsBody
          idPrefix={`inspector-${field.id}`}
          scope={field.scope}
          type={field.type}
          values={toSettingsValues(field)}
          shown={field.isActive}
          textMode="commit"
          onChange={autosave.change}
          errorFor={autosave.errorFor}
          onlineRef={onlineRef}
        />
      </div>
    </div>
  );
};
