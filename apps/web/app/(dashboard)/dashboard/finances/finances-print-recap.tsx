"use client";

import { useLocale, useTranslations } from "next-intl";

import type { FinanceMovement, FinanceSummary } from "@louez/validations";

import { useStore } from "@/contexts/store-context";
import { useFormatLocale } from "@/hooks/use-format-locale";
import { useFormatMoney } from "@/hooks/use-format-money";
import { formatStoreDate } from "@/lib/utils/store-date";
import { formatDayRange } from "@/lib/utils/util.day-range";

import { NATURE_LABEL_KEYS } from "./finances.constants";
import { formatSignedAmount } from "./util.finances";

interface FinancesPrintRecapProps {
  summary: FinanceSummary;
  movements: FinanceMovement[];
  /** The list was cut: the sheet says so rather than pass for complete. */
  truncated: boolean;
  printedAt: Date;
}

/**
 * The till-closing sheet: totals by payment method, then every movement of the
 * period. Only exists on paper — hidden on screen, the one thing left when the
 * page is printed. Literal black rather than theme tokens: browsers drop
 * backgrounds when printing, so the dark theme's light text would vanish on
 * white paper.
 */
export const FinancesPrintRecap = ({
  summary,
  movements,
  truncated,
  printedAt,
}: FinancesPrintRecapProps) => {
  const t = useTranslations("dashboard.finances");
  const locale = useLocale();
  const { dateFns: dateLocale } = useFormatLocale();
  const { storeName, timezone } = useStore();
  const formatMoney = useFormatMoney();
  const { window, totals, byMethod } = summary;

  return (
    <section className="hidden text-sm text-black print:block">
      <header className="mb-6 border-b border-black pb-3">
        <h1 className="text-xl font-bold">
          {t("print.title")} — {storeName}
        </h1>
        <p>
          {t(`period.${window.period}`)} · {formatDayRange(window, dateLocale, window.to)}
        </p>
        <p className="text-xs">
          {t("print.printedAt", {
            date: formatStoreDate(printedAt, timezone, "DATE_AT_TIME", locale),
          })}
        </p>
      </header>

      <h2 className="mb-2 text-base font-semibold">{t("print.byMethod")}</h2>
      <table className="mb-6 w-full border-collapse tabular-nums">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1 font-semibold">{t("table.method")}</th>
            <th className="py-1 text-right font-semibold">{t("chart.moneyIn")}</th>
            <th className="py-1 text-right font-semibold">{t("chart.moneyOut")}</th>
            <th className="py-1 text-right font-semibold">{t("chart.net")}</th>
          </tr>
        </thead>
        <tbody>
          {byMethod.map((entry) => (
            <tr key={entry.method} className="border-b border-neutral-300">
              <td className="py-1">{t(`methods.${entry.method}`)}</td>
              <td className="py-1 text-right">{formatMoney(entry.moneyIn)}</td>
              <td className="py-1 text-right">{formatMoney(entry.moneyOut)}</td>
              <td className="py-1 text-right">{formatMoney(entry.moneyIn - entry.moneyOut)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-black font-semibold">
            <td className="py-1">{t("print.total")}</td>
            <td className="py-1 text-right">{formatMoney(totals.moneyIn)}</td>
            <td className="py-1 text-right">{formatMoney(totals.moneyOut)}</td>
            <td className="py-1 text-right">{formatMoney(totals.net)}</td>
          </tr>
        </tfoot>
      </table>

      <h2 className="mb-2 text-base font-semibold">
        {t("print.movements")} ({movements.length})
      </h2>
      <table className="w-full border-collapse tabular-nums">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1 font-semibold">{t("detail.date")}</th>
            <th className="py-1 font-semibold">{t("table.customer")}</th>
            <th className="py-1 font-semibold">{t("table.nature")}</th>
            <th className="py-1 font-semibold">{t("table.method")}</th>
            <th className="py-1 text-right font-semibold">{t("table.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => (
            <tr key={movement.id} className="break-inside-avoid border-b border-neutral-300">
              <td className="py-1 whitespace-nowrap">
                {formatStoreDate(movement.date, timezone, "TIMESTAMP", locale)}
              </td>
              <td className="py-1">
                {movement.customerName || t("table.unknownCustomer")} · #
                {movement.reservationNumber}
              </td>
              <td className="py-1">{t(`nature.${NATURE_LABEL_KEYS[movement.nature]}`)}</td>
              <td className="py-1">{t(`methods.${movement.method}`)}</td>
              <td className="py-1 text-right whitespace-nowrap">
                {formatSignedAmount(movement.amount, formatMoney)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {truncated && (
        <p className="mt-3 text-xs">{t("print.truncated", { count: movements.length })}</p>
      )}
    </section>
  );
};
