"use client";

import { useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, Payload, ValueType } from "recharts/types/component/DefaultTooltipContent";

import { ChartColumnIcon } from "@louez/ui/icons";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";

export interface TrendDataPoint {
  date: string;
  label: string;
  visitors: number;
  pageViews: number;
  conversions: number;
}

interface TrendChartProps {
  data: TrendDataPoint[];
  showConversions?: boolean;
  /** The two series' names, when they count something else than visitors and orders. */
  labels?: { visitors: string; conversions: string };
}

/** Same hues as the badge tokens, so charts and badges agree. */
const VISITORS_COLOR = "var(--primary)";
const CONVERSIONS_COLOR = "var(--badge-success-foreground)";

export const TrendChart = ({ data, showConversions = true, labels }: TrendChartProps) => {
  const t = useTranslations("dashboard.analytics");

  if (data.every((point) => point.visitors === 0 && point.pageViews === 0)) {
    return <DashboardEmptyState icon={ChartColumnIcon} description={t("noData")} />;
  }

  return (
    <div className="h-64 w-full sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorVisitors" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={VISITORS_COLOR} stopOpacity={0.3} />
              <stop offset="95%" stopColor={VISITORS_COLOR} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorConversions" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CONVERSIONS_COLOR} stopOpacity={0.3} />
              <stop offset="95%" stopColor={CONVERSIONS_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={16}
            dy={10}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={40}
            allowDecimals={false}
          />
          <Tooltip
            content={({ active, payload, label }: TooltipContentProps<ValueType, NameType>) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-background rounded-lg border p-3 shadow-lg">
                    <p className="mb-2 font-medium">{label}</p>
                    {payload.map((entry: Payload<ValueType, NameType>) => (
                      <p
                        key={String(entry.name)}
                        className="text-sm"
                        style={{ color: entry.color }}
                      >
                        {entry.name}: {entry.value?.toLocaleString()}
                      </p>
                    ))}
                  </div>
                );
              }
              return null;
            }}
          />
          <Legend
            verticalAlign="top"
            height={36}
            iconType="circle"
            formatter={(value: string) => (
              <span className="text-muted-foreground text-sm">{value}</span>
            )}
          />
          <Area
            type="monotone"
            dataKey="visitors"
            name={labels?.visitors ?? t("visitors")}
            stroke={VISITORS_COLOR}
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorVisitors)"
          />
          {showConversions && (
            <Area
              type="monotone"
              dataKey="conversions"
              name={labels?.conversions ?? t("conversions")}
              stroke={CONVERSIONS_COLOR}
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorConversions)"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
