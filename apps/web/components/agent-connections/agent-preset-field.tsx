"use client";

import { useTranslations } from "next-intl";

import { Label, Radio, RadioGroup } from "@louez/ui";

import { AGENT_PRESETS, type AgentPreset } from "./util.agent-terms";

interface AgentPresetFieldProps {
  value: AgentPreset;
  onChange: (preset: AgentPreset) => void;
  disabled?: boolean;
}

export const AgentPresetField = ({ value, onChange, disabled }: AgentPresetFieldProps) => {
  const t = useTranslations("agentConnections");
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{t("presetsTitle")}</legend>
      <RadioGroup
        value={value}
        onValueChange={(next) => {
          const preset = AGENT_PRESETS.find((one) => one === next);
          if (preset) onChange(preset);
        }}
        disabled={disabled}
        className="gap-2"
      >
        {AGENT_PRESETS.map((preset) => (
          <Label
            key={preset}
            className="has-data-checked:border-primary/48 has-data-checked:bg-primary/4 flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal"
          >
            <Radio value={preset} className="mt-0.5" />
            <span className="min-w-0 space-y-0.5">
              <span className="block text-sm font-medium">{t(`presets.${preset}.label`)}</span>
              <span className="text-muted-foreground block text-sm">
                {t(`presets.${preset}.description`)}
              </span>
            </span>
          </Label>
        ))}
      </RadioGroup>
    </fieldset>
  );
};
