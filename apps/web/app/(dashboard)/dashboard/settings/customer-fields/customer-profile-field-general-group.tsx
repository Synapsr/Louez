"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import { Input, Label } from "@louez/ui";

import { PanelGroup } from "@/components/online-store/panel/panel-group";

interface CustomerProfileFieldGeneralGroupProps {
  idPrefix: string;
  label: string;
}

/**
 * "Général" of a Louez profile field: its name, where a store field has it,
 * but fixed (Louez relies on it: the age, the origin).
 */
export const CustomerProfileFieldGeneralGroup = ({
  idPrefix,
  label,
}: CustomerProfileFieldGeneralGroupProps) => {
  const t = useTranslations("dashboard.settings.customerFields");

  return (
    <PanelGroup title={t("builder.inspector.general")}>
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={`${idPrefix}-label`}>{t("dialog.label")}</Label>
        <Input id={`${idPrefix}-label`} value={label} readOnly className="bg-muted/60" />
        <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
          {t("builder.native.fixed")}
        </p>
      </div>
    </PanelGroup>
  );
};
