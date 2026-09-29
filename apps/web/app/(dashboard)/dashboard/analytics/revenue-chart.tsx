"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

import { ChartColumnIcon } from "@louez/ui/icons";
import { formatCurrency } from "@louez/utils";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";

interface RevenueData {
  /** Pre-formatted bucket name — a day for the short periods, a month otherwise. */
  label: string;
  revenue: number;
  payments: number;
}

interface RevenueChartProps {
  data: RevenueData[];
  currency?: string;
  initialDimension?: { width: number; height: number };
}

export const RevenueChart = ({ data, currency = "EUR", initialDimension }: RevenueChartProps) => {
  const t = useTranslations("dashboard.statistics");
  const locale = useLocale();
  const axisFormat = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 2,
  });

  if (data.every((point) => point.revenue === 0)) {
    return <DashboardEmptyState icon={ChartColumnIcon} description={t("noRevenueData")} />;
  }

  return (
    <div className="h-64 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%" initialDimension={initialDimension}>
        <AreaChart
          data-demo-target="analytics-revenue-chart"
          data={data}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
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
            width={64}
            tickFormatter={(value: number) => axisFormat.format(value)}
          />
          <Tooltip
            content={({ active, payload, label }: TooltipContentProps<ValueType, NameType>) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-background rounded-lg border p-3 shadow-md">
                    <p className="font-medium">{label}</p>
                    <p className="text-muted-foreground text-sm">
                      {t("revenueAbbrev")}:{" "}
                      {formatCurrency(payload[0].value as number, currency, locale)}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {t("paymentsCount", { count: payload[0].payload.payments })}
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--primary)"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorRevenue)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
