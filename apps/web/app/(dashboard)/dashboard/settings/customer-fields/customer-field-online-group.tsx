"use client";

import { EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { DisabledControlsProvider, useControlsDisabled } from "@louez/ui";

import { PanelGroup } from "@/components/online-store/panel/panel-group";

import { CustomerFieldOnlineControls } from "./customer-field-online-controls";
import type { CustomerFieldOnlineSettings } from "./util.customer-field-online";

interface CustomerFieldOnlineGroupProps {
  /** Prefix of the control ids, unique per Sheet. */
  idPrefix: string;
  value: CustomerFieldOnlineSettings;
  /** Recorded per rented unit: "Pour" always matters. */
  carriesItems: boolean;
  /** Social links can be asked, never required. */
  allowsRequired?: boolean;
  /** A hidden field is asked to nobody: the controls wait for it to be shown again. */
  hidden?: boolean;
  error?: string;
  onChange: (next: CustomerFieldOnlineSettings) => void;
}

/**
 * "Réservation en ligne": what the checkout asks, for whom, and whether the
 * customer may edit it later. The same group for every editable field.
 */
export const CustomerFieldOnlineGroup = ({
  idPrefix,
  value,
  carriesItems,
  allowsRequired = true,
  hidden = false,
  error,
  onChange,
}: CustomerFieldOnlineGroupProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const readOnly = useControlsDisabled();

  return (
    <PanelGroup title={t("dialog.online.title")}>
      {hidden ? (
        <p className="text-muted-foreground -mt-2 flex items-start gap-1.5 text-xs">
          <EyeOff aria-hidden className="mt-px size-3.5 shrink-0" />
          {t("builder.online.hiddenNote")}
        </p>
      ) : (
        <p className="text-muted-foreground -mt-2 text-xs">{t("dialog.online.description")}</p>
      )}
      <DisabledControlsProvider disabled={readOnly || hidden}>
        <CustomerFieldOnlineControls
          idPrefix={`${idPrefix}-online`}
          value={value}
          carriesItems={carriesItems}
          allowsRequired={allowsRequired}
          onChange={onChange}
        />
      </DisabledControlsProvider>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </PanelGroup>
  );
};
