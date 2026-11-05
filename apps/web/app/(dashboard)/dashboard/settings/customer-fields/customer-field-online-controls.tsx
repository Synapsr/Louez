"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { CUSTOMER_FIELD_COLLECT_MODES, CUSTOMER_FIELD_TARGET_MODES } from "@louez/types";
import { Label } from "@louez/ui";

import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";
import { PanelSwitchRow } from "@/components/online-store/panel/panel-switch-row";

import { CustomerFieldTargetPicker } from "./customer-field-target-picker";
import {
  type CustomerFieldOnlineSettings,
  patchOnlineSettings,
  showsTargetChoice,
} from "./util.customer-field-online";

interface CustomerFieldOnlineControlsProps {
  /** Prefix of the control ids, unique per dialog. */
  idPrefix: string;
  value: CustomerFieldOnlineSettings;
  /** The field, or the fields a template just added, are recorded per rented item. */
  carriesItems: boolean;
  /** "Pour" before "Demander au client", when the dialog asks which products first. */
  targetsFirst?: boolean;
  /** Social links can be asked, never required. */
  allowsRequired?: boolean;
  onChange: (next: CustomerFieldOnlineSettings) => void;
}

/**
 * "Demander au client", "Pour" and "Modifiable par le client": the same three
 * controls for a store field, a Louez field and a template's new fields.
 */
export const CustomerFieldOnlineControls = ({
  idPrefix,
  value,
  carriesItems,
  targetsFirst = false,
  allowsRequired = true,
  onChange,
}: CustomerFieldOnlineControlsProps) => {
  const t = useTranslations("dashboard.settings.customerFields.online");
  const scopeKey = carriesItems ? "item" : "customer";
  const asked = value.collectMode !== "never";
  const targetsHelpId = `${idPrefix}-targets-help`;

  const collectControl = (
    <div className="space-y-2">
      <Label>{t("collect")}</Label>
      <PanelSegmentedControl
        aria-label={t("collect")}
        value={value.collectMode}
        options={CUSTOMER_FIELD_COLLECT_MODES.filter(
          (mode) => allowsRequired || mode !== "required",
        ).map((mode) => ({
          value: mode,
          label: t(`collectModes.${mode}`),
        }))}
        onChange={(collectMode) => onChange(patchOnlineSettings(value, { collectMode }))}
      />
      <p className="text-muted-foreground text-xs">
        {asked ? t(`collectHelp.${scopeKey}.${value.collectMode}`) : t("collectHelp.never")}
      </p>
    </div>
  );

  const targetControl = showsTargetChoice({ carriesItems, collectMode: value.collectMode }) && (
    <div className="space-y-2">
      <Label htmlFor={`${idPrefix}-targets`}>{t("target")}</Label>
      <PanelSegmentedControl
        aria-label={t("target")}
        value={value.targetMode}
        options={CUSTOMER_FIELD_TARGET_MODES.map((mode) => ({
          value: mode,
          label: t(`targetModes.${mode}`),
        }))}
        onChange={(targetMode) => onChange(patchOnlineSettings(value, { targetMode }))}
      />
      {value.targetMode === "products" && (
        <CustomerFieldTargetPicker
          id={`${idPrefix}-targets`}
          value={value.targets}
          aria-describedby={targetsHelpId}
          onChange={(targets) => onChange(patchOnlineSettings(value, { targets }))}
        />
      )}
      {value.targetMode === "products" && value.targets.length === 0 ? (
        <p
          id={targetsHelpId}
          className="text-badge-warning-foreground flex items-start gap-1.5 text-xs font-medium"
        >
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          {t("targetsNone")}
        </p>
      ) : (
        <p id={targetsHelpId} className="text-muted-foreground text-xs">
          {t(`targetHelp.${scopeKey}.${value.targetMode}`)}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {targetsFirst ? targetControl : collectControl}
      {targetsFirst ? collectControl : targetControl}

      <div className="border-t pt-4">
        <PanelSwitchRow
          id={`${idPrefix}-customer-editable`}
          label={t("customerEditable")}
          hint={asked ? t("customerEditableHint") : t("customerEditableNeverHint")}
          checked={value.customerEditable}
          disabled={!asked}
          onCheckedChange={(customerEditable) =>
            onChange(patchOnlineSettings(value, { customerEditable }))
          }
        />
      </div>
    </div>
  );
};
