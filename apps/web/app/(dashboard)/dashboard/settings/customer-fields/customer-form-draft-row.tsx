"use client";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { CustomerFormItemPreview } from "./customer-form-item-preview";
import { CustomerFormRowFrame } from "./customer-form-row-frame";
import { toDraftPreview } from "./util.customer-fields-builder";

/**
 * The field being created, at the end of its tab where it will land,
 * following what is typed in the Sheet: its name, its kind, its width.
 */
export const CustomerFormDraftRow = () => {
  const t = useTranslations("dashboard.settings.customerFields.builder.field");
  const { draftForm } = useCustomerFieldsBuilder();
  const values = useStore(draftForm.store, (state) => state.values);
  const preview = toDraftPreview(values, t("draftPlaceholder"));

  return (
    <CustomerFormRowFrame
      label={preview.label}
      full={values.width === "full"}
      highlighted
      preview={<CustomerFormItemPreview field={{ kind: "custom", definition: preview }} />}
      tag={
        // On the frame: clear of the input, whatever its kind.
        <span className="bg-card absolute end-3 -top-2.5 rounded-sm">
          <Badge variant="info">{t("draftBadge")}</Badge>
        </span>
      }
    />
  );
};
