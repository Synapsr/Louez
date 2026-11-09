"use client";

import { useTranslations } from "next-intl";

import { Badge, Checkbox, Label } from "@louez/ui";

import { AGENT_BUNDLES, withBundle, type AgentBundle } from "./util.agent-terms";

interface AgentBundlesFieldProps {
  /** The bundles to offer: those that hold a tool for this agent (from the API). */
  offered: readonly AgentBundle[];
  value: readonly AgentBundle[];
  onChange: (bundles: AgentBundle[]) => void;
  disabled?: boolean;
}

export const AgentBundlesField = ({
  offered,
  value,
  onChange,
  disabled,
}: AgentBundlesFieldProps) => {
  const t = useTranslations("agentConnections");
  return (
    <fieldset className="space-y-3">
      <div className="space-y-1">
        <legend className="text-sm font-medium">{t("bundlesTitle")}</legend>
        <p className="text-muted-foreground text-sm">{t("bundlesHint")}</p>
      </div>
      <div className="divide-y rounded-lg border">
        {AGENT_BUNDLES.filter((bundle) => offered.includes(bundle)).map((bundle) => (
          <Label
            key={bundle}
            className="flex cursor-pointer items-start gap-3 px-3 py-2.5 font-normal"
          >
            <Checkbox
              className="mt-0.5"
              checked={value.includes(bundle)}
              disabled={disabled}
              onCheckedChange={(checked) => onChange(withBundle(value, bundle, checked))}
            />
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {t(`bundles.${bundle}.label`)}
                {bundle === "daily" && <Badge variant="secondary">{t("recommended")}</Badge>}
              </span>
              <span className="text-muted-foreground block text-sm">
                {t(`bundles.${bundle}.description`)}
              </span>
            </span>
          </Label>
        ))}
      </div>
      {value.length === 0 && (
        <p className="text-destructive text-sm" role="alert">
          {t("bundlesNone")}
        </p>
      )}
    </fieldset>
  );
};
