"use client";

import { useLocale, useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

import { ChartColumnIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";
import type { FinanceSummary } from "@louez/validations";

import { DASHBOARD_ACCENT_FILL } from "@/components/dashboard/shared/dashboard-accent";
import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import { useFormatLocale } from "@/hooks/use-format-locale";
import { useFormatMoney } from "@/hooks/use-format-money";
import { formatStoreDate } from "@/lib/utils/store-date";
import { dayToDate } from "@/lib/utils/util.day-range";

interface FinancesCashflowChartProps {
  series: FinanceSummary["series"];
  granularity: FinanceSummary["window"]["granularity"];
}

/** Money in against money out, one pair of bars per day (per month on long ranges). */
export const FinancesCashflowChart = ({ series, granularity }: FinancesCashflowChartProps) => {
  const t = useTranslations("dashboard.finances.chart");
  const locale = useLocale();
  const { intl: formatLocale } = useFormatLocale();
  const formatMoney = useFormatMoney();
  const axisFormat = new Intl.NumberFormat(formatLocale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });

  if (series.every((point) => point.moneyIn === 0 && point.moneyOut === 0)) {
    return <DashboardEmptyState icon={ChartColumnIcon} description={t("empty")} />;
  }

  // Bucket keys are store days already: formatting them needs no timezone.
  const data = series.map((point) => ({
    ...point,
    label: formatStoreDate(
      dayToDate(point.key),
      undefined,
      granularity === "month" ? "MMM yyyy" : "d MMM",
      locale,
    ),
  }));

  return (
    <div className="space-y-3">
      <div className="text-muted-foreground flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn("size-2.5 rounded-full", DASHBOARD_ACCENT_FILL.success)}
          />
          {t("moneyIn")}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn("size-2.5 rounded-full", DASHBOARD_ACCENT_FILL.neutral)}
          />
          {t("moneyOut")}
        </span>
      </div>
      <div className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              minTickGap={16}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(value: number) => axisFormat.format(value)}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={({ active, payload, label }: TooltipContentProps<ValueType, NameType>) => {
                const point = payload?.[0]?.payload;
                if (!active || !point) return null;
                return (
                  <div className="bg-background rounded-lg border p-3 shadow-md">
                    <p className="font-medium">{label}</p>
                    <p className="text-muted-foreground text-sm tabular-nums">
                      {t("moneyIn")}: {formatMoney(point.moneyIn)}
                    </p>
                    <p className="text-muted-foreground text-sm tabular-nums">
                      {t("moneyOut")}: {formatMoney(point.moneyOut)}
                    </p>
                    <p className="text-sm font-medium tabular-nums">
                      {t("net")}: {formatMoney(point.moneyIn - point.moneyOut)}
                    </p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="moneyIn"
              fill="var(--badge-success-foreground)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
            <Bar
              dataKey="moneyOut"
              fill="var(--badge-expired-foreground)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
