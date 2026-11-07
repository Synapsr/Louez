"use client";

import { useTranslations } from "next-intl";

import { Label, Switch } from "@louez/ui";

interface AgentConfirmFieldProps {
  value: boolean;
  onChange: (confirmSensitive: boolean) => void;
  disabled?: boolean;
}

export const AgentConfirmField = ({ value, onChange, disabled }: AgentConfirmFieldProps) => {
  const t = useTranslations("agentConnections");
  return (
    <Label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3 font-normal">
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{t("confirm.label")}</span>
        <span className="text-muted-foreground block text-sm">{t("confirm.description")}</span>
      </span>
      <Switch checked={value} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" />
    </Label>
  );
};
