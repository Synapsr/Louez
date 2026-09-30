"use client";

import type { Ref } from "react";

import { useTranslations } from "next-intl";

import type { CustomerFieldScope, CustomerFieldType } from "@louez/types";
import { Label } from "@louez/ui";

import { PanelGroup } from "@/components/online-store/panel/panel-group";
import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";

import { CustomerFieldAdvancedGroup } from "./customer-field-advanced-group";
import { CustomerFieldFormatSelect } from "./customer-field-format-select";
import { CustomerFieldOnlineControls } from "./customer-field-online-controls";
import { CustomerFieldOptionsInput } from "./customer-field-options-input";
import { CustomerFieldSwitchSetting } from "./customer-field-switch-setting";
import { CustomerFieldTextSetting } from "./customer-field-text-setting";
import { pickOnlineSettings } from "./util.customer-field-online";
import type {
  CustomerFieldSettingKey,
  CustomerFieldSettingsValues,
} from "./util.customer-fields-builder";

interface CustomerFieldSettingsBodyProps {
  /** Prefix of the control ids, unique per inspector. */
  idPrefix: string;
  scope: CustomerFieldScope;
  type: CustomerFieldType;
  values: CustomerFieldSettingsValues;
  /** `live` for a field being created, `commit` (blur or Enter) for a saved one. */
  textMode: "live" | "commit";
  autoFocusLabel?: boolean;
  /** Returns false when a text is refused, so the saved one comes back. */
  onChange: (
    key: CustomerFieldSettingKey,
    changes: Partial<CustomerFieldSettingsValues>,
  ) => boolean | void;
  errorFor: (key: CustomerFieldSettingKey) => string | undefined;
  /** Put on the top of "Réservation en ligne", for the client view to scroll to. */
  onlineRef?: Ref<HTMLParagraphElement>;
}

/**
 * Every setting of a field, most used first: what it is called and how it
 * reads, then whether the team must fill it, then what the checkout asks,
 * then the rare switches, folded. The same body for a field being created
 * and a saved one; only how changes travel differs.
 */
export const CustomerFieldSettingsBody = ({
  idPrefix,
  scope,
  type,
  values,
  textMode,
  autoFocusLabel = false,
  onChange,
  errorFor,
  onlineRef,
}: CustomerFieldSettingsBodyProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const isCustomer = scope === "customer";
  // A few help lines read differently once the value lives on a rented unit.
  const flagHint = (flag: "sensitive" | "contract") =>
    t(`dialog.flags.${flag}${isCustomer ? "" : "Item"}Help`);

  return (
    <div className="flex flex-col divide-y">
      <PanelGroup title={t("builder.inspector.general")}>
        <CustomerFieldTextSetting
          id={`${idPrefix}-label`}
          label={t("dialog.label")}
          value={values.label}
          placeholder={t(isCustomer ? "dialog.labelPlaceholder" : "dialog.labelPlaceholderItem")}
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
            {errorFor("options") && (
              <p className="text-destructive text-sm">{errorFor("options")}</p>
            )}
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
        {isCustomer && (
          <div className="border-t pt-4">
            <CustomerFieldSwitchSetting
              id={`${idPrefix}-required`}
              label={t("dialog.flags.requiredTeam")}
              hint={t("dialog.flags.requiredHelp")}
              checked={values.isRequired}
              error={errorFor("isRequired")}
              onCheckedChange={(isRequired) => onChange("isRequired", { isRequired })}
            />
          </div>
        )}
      </PanelGroup>

      <PanelGroup title={t("dialog.online.title")}>
        <p ref={onlineRef} className="text-muted-foreground -mt-2 text-xs">
          {t("dialog.online.description")}
        </p>
        <CustomerFieldOnlineControls
          idPrefix={`${idPrefix}-online`}
          value={pickOnlineSettings(values)}
          carriesItems={!isCustomer}
          onChange={(next) => onChange("online", next)}
        />
        {errorFor("online") && <p className="text-destructive text-sm">{errorFor("online")}</p>}
      </PanelGroup>

      <CustomerFieldAdvancedGroup title={t("builder.inspector.advanced")}>
        <CustomerFieldSwitchSetting
          id={`${idPrefix}-sensitive`}
          label={t("dialog.flags.sensitive")}
          hint={flagHint("sensitive")}
          checked={values.isSensitive}
          error={errorFor("isSensitive")}
          onCheckedChange={(isSensitive) => onChange("isSensitive", { isSensitive })}
        />
        <CustomerFieldSwitchSetting
          id={`${idPrefix}-contract`}
          label={t("dialog.flags.contract")}
          hint={flagHint("contract")}
          checked={values.showOnContract}
          error={errorFor("showOnContract")}
          onCheckedChange={(showOnContract) => onChange("showOnContract", { showOnContract })}
        />
        {isCustomer && (
          <>
            <CustomerFieldSwitchSetting
              id={`${idPrefix}-search`}
              label={t("dialog.flags.search")}
              hint={t("dialog.flags.searchHelp")}
              checked={values.isSearchable}
              error={errorFor("isSearchable")}
              onCheckedChange={(isSearchable) => onChange("isSearchable", { isSearchable })}
            />
            <CustomerFieldSwitchSetting
              id={`${idPrefix}-list`}
              label={t("dialog.flags.list")}
              hint={t("dialog.flags.listHelp")}
              checked={values.showInList}
              error={errorFor("showInList")}
              onCheckedChange={(showInList) => onChange("showInList", { showInList })}
            />
            <div className="flex flex-col gap-2 border-t pt-4">
              <Label>{t("dialog.appliesTo")}</Label>
              <PanelSegmentedControl
                aria-label={t("dialog.appliesTo")}
                value={values.appliesTo}
                onChange={(appliesTo) => onChange("appliesTo", { appliesTo })}
                options={[
                  { value: "all", label: t("dialog.appliesToAll") },
                  { value: "individual", label: t("dialog.appliesToIndividual") },
                  { value: "business", label: t("dialog.appliesToBusiness") },
                ]}
              />
              {errorFor("appliesTo") && (
                <p className="text-destructive text-sm">{errorFor("appliesTo")}</p>
              )}
            </div>
          </>
        )}
      </CustomerFieldAdvancedGroup>
    </div>
  );
};
