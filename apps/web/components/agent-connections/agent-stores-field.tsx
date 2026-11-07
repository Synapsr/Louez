"use client";

import { useTranslations } from "next-intl";

import { Checkbox, Label } from "@louez/ui";

import { withStore, type AgentStores } from "./util.agent-terms";

interface AgentStoresFieldProps {
  stores: ReadonlyArray<{ id: string; name: string; role: "owner" | "member" }>;
  value: AgentStores;
  onChange: (stores: AgentStores) => void;
  disabled?: boolean;
}

export const AgentStoresField = ({ stores, value, onChange, disabled }: AgentStoresFieldProps) => {
  const t = useTranslations("agentConnections");
  const listed = value.all ? stores.map((store) => store.id) : value.ids;
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{t("storesTitle")}</legend>
      <div className="divide-y rounded-lg border">
        {stores.map((store) => (
          <Label
            key={store.id}
            className="flex cursor-pointer items-center gap-3 px-3 py-2.5 font-normal"
          >
            <Checkbox
              checked={listed.includes(store.id)}
              disabled={disabled || value.all}
              onCheckedChange={(checked) => onChange(withStore(value, store.id, checked))}
            />
            <span className="min-w-0 flex-1 truncate text-sm">{store.name}</span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {t(`roles.${store.role}`)}
            </span>
          </Label>
        ))}
        <Label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 font-normal">
          <Checkbox
            className="mt-0.5"
            checked={value.all}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange(
                checked ? { all: true } : { all: false, ids: stores.map((store) => store.id) },
              )
            }
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">{t("storesAll")}</span>
            <span className="text-muted-foreground block text-sm">{t("storesAllHint")}</span>
          </span>
        </Label>
      </div>
      {!value.all && value.ids.length === 0 && (
        <p className="text-destructive text-sm" role="alert">
          {t("storesNone")}
        </p>
      )}
    </fieldset>
  );
};
