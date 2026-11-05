"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldScope } from "@louez/types";

import { PanelGroup } from "@/components/online-store/panel/panel-group";

import { CustomerFieldSwitchSetting } from "./customer-field-switch-setting";

interface CustomerFieldRecordGroupProps {
  /** Prefix of the control ids, unique per Sheet. */
  idPrefix: string;
  scope: CustomerFieldScope;
  /** "Afficher sur la fiche"; null for a field being created (it is shown). */
  shown: boolean | null;
  /** "Obligatoire pour l'équipe"; null where it is not offered (per rented item, links). */
  required: boolean | null;
  shownError?: string;
  requiredError?: string;
  onShownChange: (shown: boolean) => void;
  onRequiredChange: (required: boolean) => void;
}

/**
 * Whether the team meets the field, and must fill it: the same two switches
 * for a store field and a Louez one. Hidden, a field is required of nobody.
 */
export const CustomerFieldRecordGroup = ({
  idPrefix,
  scope,
  shown,
  required,
  shownError,
  requiredError,
  onShownChange,
  onRequiredChange,
}: CustomerFieldRecordGroupProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  if (shown === null && required === null) return null;

  return (
    <PanelGroup title={t(`builder.record.${scope}`)}>
      {shown !== null && (
        <CustomerFieldSwitchSetting
          id={`${idPrefix}-shown`}
          label={t(`builder.visibility.shown.${scope}`)}
          hint={t(
            shown
              ? `builder.visibility.shownHint.${scope}`
              : `builder.visibility.hiddenHint.${scope}`,
          )}
          checked={shown}
          error={shownError}
          onCheckedChange={onShownChange}
        />
      )}
      {required !== null && (
        <CustomerFieldSwitchSetting
          id={`${idPrefix}-required`}
          label={t("dialog.flags.requiredTeam")}
          hint={t("dialog.flags.requiredHelp")}
          checked={required}
          disabled={shown === false}
          error={requiredError}
          onCheckedChange={onRequiredChange}
        />
      )}
    </PanelGroup>
  );
};
