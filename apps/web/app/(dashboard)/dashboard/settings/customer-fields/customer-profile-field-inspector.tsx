"use client";

import { useTranslations } from "next-intl";

import type { CustomerProfileFieldKey, CustomerProfileFieldSettings } from "@louez/types";

import { CustomerFieldInspectorHeader } from "./customer-field-inspector-header";
import { type InspectorFocus, useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { PROFILE_FIELD_TYPES } from "./customer-fields.constants";
import { CustomerProfileFieldSettingsBody } from "./customer-profile-field-settings-body";
import { useCustomerProfileFieldAutosave } from "./use-customer-profile-field-autosave";
import { useInspectorOnlineScroll } from "./use-inspector-online-scroll";

interface CustomerProfileFieldInspectorProps {
  field: CustomerProfileFieldKey;
  settings: CustomerProfileFieldSettings;
  focus: InspectorFocus;
  /** Changes on every click on the field, so the same focus scrolls again. */
  request: number;
}

/**
 * A Louez profile field in the inspector: the same header and settings as a
 * store field, saved as they are made. No "⋯": it cannot move or go.
 */
export const CustomerProfileFieldInspector = ({
  field,
  settings,
  focus,
  request,
}: CustomerProfileFieldInspectorProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { clearSelection } = useCustomerFieldsBuilder();
  const autosave = useCustomerProfileFieldAutosave(field);
  const { bodyRef, onlineRef } = useInspectorOnlineScroll(focus, request);
  const type = PROFILE_FIELD_TYPES[field];
  const label = t(`native.${field}`);
  // "Lien" would undersell a list of networks and a website.
  const typeLabel =
    field === "socialLinks" ? t("builder.native.socialLinksType") : t(`dialog.types.${type}`);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CustomerFieldInspectorHeader
        title={label}
        type={type}
        typeLabel={typeLabel}
        scope="customer"
        louez
        status={autosave.status}
        onClose={clearSelection}
      />
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
        <CustomerProfileFieldSettingsBody
          field={field}
          label={label}
          typeLabel={typeLabel}
          settings={settings}
          onChange={autosave.change}
          errorFor={autosave.errorFor}
          onlineRef={onlineRef}
        />
      </div>
    </div>
  );
};
