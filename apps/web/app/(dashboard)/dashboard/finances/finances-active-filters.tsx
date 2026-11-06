"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Button } from "@louez/ui";

import { useFormatMoney } from "@/hooks/use-format-money";

import { NATURE_LABEL_KEYS } from "./finances.constants";
import type { FinanceSearchState } from "./util.finances";

type FilterKey = "direction" | "method" | "nature" | "status" | "min" | "max" | "q";

interface FinancesActiveFiltersProps {
  state: FinanceSearchState;
  onRemove: (key: FilterKey) => void;
  onClearAll: () => void;
}

/** Every filter in force as a removable chip: nothing narrows the list out of sight. */
export const FinancesActiveFilters = ({
  state,
  onRemove,
  onClearAll,
}: FinancesActiveFiltersProps) => {
  const t = useTranslations("dashboard.finances");
  const formatMoney = useFormatMoney();

  const chips: { key: FilterKey; label: string }[] = [
    ...(state.q?.trim()
      ? [{ key: "q" as const, label: t("filters.activeSearch", { term: state.q.trim() }) }]
      : []),
    ...(state.direction
      ? [{ key: "direction" as const, label: t(`filters.direction.${state.direction}`) }]
      : []),
    ...(state.method ? [{ key: "method" as const, label: t(`methods.${state.method}`) }] : []),
    ...(state.nature
      ? [{ key: "nature" as const, label: t(`nature.${NATURE_LABEL_KEYS[state.nature]}`) }]
      : []),
    ...(state.status ? [{ key: "status" as const, label: t(`status.${state.status}`) }] : []),
    ...(state.min !== null
      ? [{ key: "min" as const, label: t("filters.activeMin", { amount: formatMoney(state.min) }) }]
      : []),
    ...(state.max !== null
      ? [{ key: "max" as const, label: t("filters.activeMax", { amount: formatMoney(state.max) }) }]
      : []),
  ];

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Badge key={chip.key} variant="outline" className="gap-1 py-1 pr-1 pl-2 font-medium">
          {chip.label}
          <button
            type="button"
            aria-label={t("filters.remove", { label: chip.label })}
            onClick={() => onRemove(chip.key)}
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring rounded-sm p-0.5 focus-visible:ring-2 focus-visible:outline-none"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      {chips.length > 1 && (
        <Button type="button" variant="ghost" size="xs" onClick={onClearAll}>
          {t("filters.clearAll")}
        </Button>
      )}
    </div>
  );
};
