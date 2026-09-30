"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldScope, CustomerFieldType } from "@louez/types";
import { Label } from "@louez/ui";

import { PanelGroup } from "@/components/online-store/panel/panel-group";

import { CustomerFieldFormatSelect } from "./customer-field-format-select";
import { CustomerFieldOptionsInput } from "./customer-field-options-input";
import { CustomerFieldTextSetting } from "./customer-field-text-setting";
import type {
  CustomerFieldSettingKey,
  CustomerFieldSettingsChanges,
  CustomerFieldSettingsValues,
} from "./util.customer-fields-builder";

interface CustomerFieldGeneralGroupProps {
  idPrefix: string;
  scope: CustomerFieldScope;
  type: CustomerFieldType;
  values: Pick<CustomerFieldSettingsValues, "label" | "helpText" | "options" | "unit" | "format">;
  /** `live` for a field being created, `commit` (blur or Enter) for a saved one. */
  textMode: "live" | "commit";
  autoFocusLabel: boolean;
  /** Returns false when a text is refused, so the saved one comes back. */
  onChange: (key: CustomerFieldSettingKey, changes: CustomerFieldSettingsChanges) => boolean | void;
  errorFor: (key: CustomerFieldSettingKey) => string | undefined;
}

/** "Général" of a store field: its name, its help line, and what its type needs. */
export const CustomerFieldGeneralGroup = ({
  idPrefix,
  scope,
  type,
  values,
  textMode,
  autoFocusLabel,
  onChange,
  errorFor,
}: CustomerFieldGeneralGroupProps) => {
  const t = useTranslations("dashboard.settings.customerFields");

  return (
    <PanelGroup title={t("builder.inspector.general")}>
      <CustomerFieldTextSetting
        id={`${idPrefix}-label`}
        label={t("dialog.label")}
        value={values.label}
        placeholder={t(
          scope === "customer" ? "dialog.labelPlaceholder" : "dialog.labelPlaceholderItem",
        )}
        maxLength={100}
        mode={textMode}
        autoFocus={autoFocusLabel}
        error={errorFor("label")}
        onChange={(label) => onChange("label", { label })}
      />
      <CustomerFieldTextSetting
        id={`${idPrefix}-help`}
        label={t("dialog.helpText")}
        value={values.helpText}
        placeholder={t("dialog.helpTextPlaceholder")}
        maxLength={255}
        mode={textMode}
        error={errorFor("helpText")}
        onChange={(helpText) => onChange("helpText", { helpText })}
      />
      {type === "select" && (
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={`${idPrefix}-options`}>{t("dialog.options")}</Label>
          <CustomerFieldOptionsInput
            id={`${idPrefix}-options`}
            value={values.options}
            placeholder={t("dialog.optionsPlaceholder")}
            invalid={Boolean(errorFor("options"))}
            onChange={(options) => onChange("options", { options })}
          />
          {errorFor("options") && <p className="text-destructive text-sm">{errorFor("options")}</p>}
        </div>
      )}
      {type === "number" && (
        <CustomerFieldTextSetting
          id={`${idPrefix}-unit`}
          label={t("dialog.unit")}
          value={values.unit}
          placeholder={t("dialog.unitPlaceholder")}
          maxLength={32}
          mode={textMode}
          error={errorFor("unit")}
          onChange={(unit) => onChange("unit", { unit })}
        />
      )}
      {type === "text" && (
        <CustomerFieldFormatSelect
          id={`${idPrefix}-format`}
          value={values.format}
          onChange={(format) => onChange("format", { format })}
        />
      )}
    </PanelGroup>
  );
};
