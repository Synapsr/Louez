"use client";

import type { ReactNode } from "react";

import { useTranslations } from "next-intl";

import type { CustomerFieldScope, CustomerFieldType } from "@louez/types";
import { Label } from "@louez/ui";

import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";

import { CustomerFieldAdvancedGroup } from "./customer-field-advanced-group";
import { CustomerFieldGeneralGroup } from "./customer-field-general-group";
import { CustomerFieldOnlineGroup } from "./customer-field-online-group";
import { CustomerFieldRecordGroup } from "./customer-field-record-group";
import { CustomerFieldSwitchSetting } from "./customer-field-switch-setting";
import { pickOnlineSettings } from "./util.customer-field-online";
import type {
  CustomerFieldSettingKey,
  CustomerFieldSettingsChanges,
  CustomerFieldSettingsValues,
} from "./util.customer-fields-builder";

interface CustomerFieldSettingsBodyProps {
  /** Prefix of the control ids, unique per Sheet. */
  idPrefix: string;
  scope: CustomerFieldScope;
  type: CustomerFieldType;
  values: CustomerFieldSettingsValues;
  /** "Afficher sur la fiche" of a saved field; null for a field being created (it is shown). */
  shown: boolean | null;
  /** `live` for a field being created, `commit` (blur or Enter) for a saved one. */
  textMode: "live" | "commit";
  autoFocusLabel?: boolean;
  /** "Mise en page", right after what the field is. */
  layout: ReactNode;
  /** Returns false when a text is refused, so the saved one comes back. */
  onChange: (key: CustomerFieldSettingKey, changes: CustomerFieldSettingsChanges) => boolean | void;
  errorFor: (key: CustomerFieldSettingKey) => string | undefined;
}

/**
 * Every setting of a store field, in the order every editable field shares:
 * what it is, where it sits, whether the team meets it and must fill it,
 * what the checkout asks, then the rare switches, folded. The same body for
 * a field being created and a saved one; only how changes travel differs.
 */
export const CustomerFieldSettingsBody = ({
  idPrefix,
  scope,
  type,
  values,
  shown,
  textMode,
  autoFocusLabel = false,
  layout,
  onChange,
  errorFor,
}: CustomerFieldSettingsBodyProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const isCustomer = scope === "customer";
  // A few help lines read differently once the value lives on a rented item.
  const flagHint = (flag: "sensitive" | "contract") =>
    t(`dialog.flags.${flag}${isCustomer ? "" : "Item"}Help`);

  return (
    <div className="flex flex-col divide-y">
      <CustomerFieldGeneralGroup
        idPrefix={idPrefix}
        scope={scope}
        type={type}
        values={values}
        textMode={textMode}
        autoFocusLabel={autoFocusLabel}
        onChange={onChange}
        errorFor={errorFor}
      />

      {layout}

      <CustomerFieldRecordGroup
        idPrefix={idPrefix}
        scope={scope}
        shown={shown}
        required={isCustomer ? values.isRequired : null}
        shownError={errorFor("isActive")}
        requiredError={errorFor("isRequired")}
        onShownChange={(isActive) => onChange("isActive", { isActive })}
        onRequiredChange={(isRequired) => onChange("isRequired", { isRequired })}
      />

      <CustomerFieldOnlineGroup
        idPrefix={idPrefix}
        value={pickOnlineSettings(values)}
        carriesItems={!isCustomer}
        hidden={shown === false}
        error={errorFor("online")}
        onChange={(next) => onChange("online", next)}
      />

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
