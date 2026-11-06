"use client";

import { useLocale, useTranslations } from "next-intl";

import { useStore } from "@/contexts/store-context";
import { formatStoreDate } from "@/lib/utils/store-date";
import { dayToDate } from "@/lib/utils/util.day-range";

import { NATURE_LABEL_KEYS } from "./finances.constants";
import { FinancesMovementAmount } from "./finances-movement-amount";
import { FinancesMovementStatusBadge } from "./finances-movement-status-badge";
import type { FinanceMovementDay } from "./util.finances";

interface FinancesMovementsCardsProps {
  days: FinanceMovementDay[];
  onSelect: (movementId: string) => void;
}

/** The ledger on a phone: one card per day, its net in the header, a row per movement. */
export const FinancesMovementsCards = ({ days, onSelect }: FinancesMovementsCardsProps) => {
  const t = useTranslations("dashboard.finances");
  const locale = useLocale();
  const { timezone } = useStore();

  return (
    <div className="space-y-3">
      {days.map((day) => (
        <section key={day.key} className="bg-card shadow-card overflow-hidden rounded-2xl border">
          <header className="bg-muted/50 flex items-center justify-between gap-3 border-b px-4 py-2.5">
            <h3 className="text-sm font-semibold first-letter:uppercase">
              {formatStoreDate(dayToDate(day.key), undefined, "EEE d MMM", locale)}
            </h3>
            <FinancesMovementAmount amount={day.net} className="text-sm font-semibold" />
          </header>
          <ul className="divide-y">
            {day.movements.map((movement) => (
              <li key={movement.id}>
                <button
                  type="button"
                  onClick={() => onSelect(movement.id)}
                  className="hover:bg-muted/60 focus-visible:ring-ring flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                >
                  <span className="min-w-0 space-y-0.5">
                    <span className="block truncate text-sm font-medium">
                      {movement.customerName || t("table.unknownCustomer")}
                    </span>
                    <span className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                      <span className="tabular-nums">
                        {formatStoreDate(movement.date, timezone, "TIME_ONLY", locale)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{t(`nature.${NATURE_LABEL_KEYS[movement.nature]}`)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{t(`methods.${movement.method}`)}</span>
                      <FinancesMovementStatusBadge status={movement.status} />
                    </span>
                  </span>
                  <FinancesMovementAmount
                    amount={movement.amount}
                    counted={movement.counted}
                    className="shrink-0 text-sm font-medium"
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};
