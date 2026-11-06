"use client";

import { useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from "@louez/ui";
import {
  FINANCE_MOVEMENT_DIRECTIONS,
  FINANCE_PAYMENT_METHODS,
  type FinanceMovementDirection,
  type FinancePaymentMethod,
} from "@louez/validations";

import { SearchInput } from "@/components/ui/search-input";

import { FinancesMoreFilters } from "./finances-more-filters";
import type { FinancesMoreFiltersValue } from "./finances-more-filters-form";
import { countPopoverFilters, type FinanceSearchState } from "./util.finances";

interface FinancesMovementsFiltersProps {
  state: FinanceSearchState;
  onSearchChange: (search: string) => void;
  onDirectionChange: (direction: FinanceMovementDirection | null) => void;
  onMethodChange: (method: FinancePaymentMethod | null) => void;
  onMoreFiltersApply: (value: FinancesMoreFiltersValue) => void;
}

const ALL = "all";

/** Three controls in sight — search, direction, method — and the rest behind "Filtres". */
export const FinancesMovementsFilters = ({
  state,
  onSearchChange,
  onDirectionChange,
  onMethodChange,
  onMoreFiltersApply,
}: FinancesMovementsFiltersProps) => {
  const t = useTranslations("dashboard.finances");

  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="min-w-0 flex-1 sm:max-w-sm">
        <SearchInput
          value={state.q ?? ""}
          onChange={(event) => onSearchChange(event.target.value)}
          onClear={() => onSearchChange("")}
          placeholder={t("filters.searchPlaceholder")}
          clearLabel={t("filters.clearSearch")}
        />
      </div>

      <ToggleGroup
        aria-label={t("filters.direction.label")}
        value={[state.direction ?? ALL]}
        onValueChange={(value: string[]) => {
          const [selected] = value;
          // A segmented control always keeps one segment on.
          if (!selected) return;
          onDirectionChange(
            FINANCE_MOVEMENT_DIRECTIONS.find((direction) => direction === selected) ?? null,
          );
        }}
      >
        <ToggleGroupItem value={ALL}>{t("filters.direction.all")}</ToggleGroupItem>
        <ToggleGroupItem value="in">{t("filters.direction.in")}</ToggleGroupItem>
        <ToggleGroupItem value="out">{t("filters.direction.out")}</ToggleGroupItem>
      </ToggleGroup>

      <Select
        value={state.method ?? ALL}
        onValueChange={(value) => {
          if (value === null) return;
          onMethodChange(FINANCE_PAYMENT_METHODS.find((method) => method === value) ?? null);
        }}
      >
        <SelectTrigger className="w-full sm:w-48" aria-label={t("filters.method")}>
          <SelectValue>
            {state.method ? t(`methods.${state.method}`) : t("filters.allMethods")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL} label={t("filters.allMethods")}>
            {t("filters.allMethods")}
          </SelectItem>
          {FINANCE_PAYMENT_METHODS.map((method) => (
            <SelectItem key={method} value={method} label={t(`methods.${method}`)}>
              {t(`methods.${method}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <FinancesMoreFilters
        value={{ nature: state.nature, status: state.status, min: state.min, max: state.max }}
        activeCount={countPopoverFilters(state)}
        onApply={onMoreFiltersApply}
      />
    </div>
  );
};
