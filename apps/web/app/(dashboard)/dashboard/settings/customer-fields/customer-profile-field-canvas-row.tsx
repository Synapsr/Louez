"use client";

import { useTranslations } from "next-intl";

import type { CustomerProfileFieldKey, CustomerProfileFieldSettings } from "@louez/types";

import { CustomerFieldBadges } from "./customer-field-badges";
import { CustomerFieldRowFrame } from "./customer-field-row-frame";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { CustomerProfileFieldPreview } from "./customer-profile-field-preview";
import {
  type CanvasFieldRef,
  isSameCanvasField,
  profileFieldFlags,
  toCanvasFieldKey,
} from "./util.customer-field-canvas";

interface CustomerProfileFieldCanvasRowProps {
  field: CustomerProfileFieldKey;
  settings: CustomerProfileFieldSettings;
}

/**
 * A Louez profile field on the canvas: the same row as the store's fields,
 * marked "Champ Louez", with no handle and no "⋯" (it cannot move or go).
 */
export const CustomerProfileFieldCanvasRow = ({
  field,
  settings,
}: CustomerProfileFieldCanvasRowProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { selection, selectField } = useCustomerFieldsBuilder();
  const fieldRef: CanvasFieldRef = { kind: "profile", key: field };

  return (
    <CustomerFieldRowFrame
      canvasKey={toCanvasFieldKey(fieldRef)}
      selectLabel={t("builder.field.select", { label: t(`native.${field}`) })}
      selected={isSameCanvasField(selection, fieldRef)}
      muted={settings.visibility === "hidden"}
      onSelect={(event) => selectField(fieldRef, { fromKeyboard: event.detail === 0 })}
      preview={
        <CustomerProfileFieldPreview
          field={field}
          required={settings.visibility === "required"}
          id={`canvas-profile-${field}`}
        />
      }
      badges={<CustomerFieldBadges flags={profileFieldFlags(settings)} />}
    />
  );
};
