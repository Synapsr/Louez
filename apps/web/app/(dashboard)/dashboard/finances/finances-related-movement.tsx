"use client";

import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { FinanceMovementDetail } from "@louez/validations";

import { useStore } from "@/contexts/store-context";
import { formatStoreDate } from "@/lib/utils/store-date";

import { NATURE_LABEL_KEYS } from "./finances.constants";
import { FinancesMovementAmount } from "./finances-movement-amount";

interface FinancesRelatedMovementProps {
  movement: FinanceMovementDetail["refunds"][number];
  onSelect: (movementId: string) => void;
}

/** One link of the chain payment ↔ refunds: clicking it moves the sheet to that row. */
export const FinancesRelatedMovement = ({ movement, onSelect }: FinancesRelatedMovementProps) => {
  const t = useTranslations("dashboard.finances");
  const locale = useLocale();
  const { timezone } = useStore();

  return (
    <button
      type="button"
      onClick={() => onSelect(movement.id)}
      className="group hover:bg-muted/60 focus-visible:ring-ring flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {t(`nature.${NATURE_LABEL_KEYS[movement.nature]}`)}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {formatStoreDate(movement.date, timezone, "DATE_AT_TIME", locale)} ·{" "}
          {t(`methods.${movement.method}`)}
        </span>
      </span>
      <FinancesMovementAmount
        amount={movement.amount}
        counted={movement.status === "settled"}
        className="shrink-0 text-sm font-medium"
      />
      <ChevronRight className="text-muted-foreground/60 group-hover:text-muted-foreground size-4 shrink-0" />
    </button>
  );
};
