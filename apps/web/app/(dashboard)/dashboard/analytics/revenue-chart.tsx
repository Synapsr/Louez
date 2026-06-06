'use client';

import { TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type {
  NameType,
  ValueType,
} from 'recharts/types/component/DefaultTooltipContent';

import { formatCurrency, getCurrencySymbol } from '@louez/utils';

interface RevenueData {
  month: string;
  revenue: number;
  payments: number;
}

interface RevenueChartProps {
  data: RevenueData[];
  currency?: string;
  includeManualPayments?: boolean;
}

export function RevenueChart({
  data,
  currency = 'EUR',
  includeManualPayments = false,
}: RevenueChartProps) {
  const t = useTranslations('dashboard.statistics');
  const currencySymbol = getCurrencySymbol(currency);

  if (data.every((d) => d.revenue === 0)) {
    return (
      <div className="text-muted-foreground flex h-[300px] flex-col items-center justify-center">
        <TrendingUp className="mb-2 h-8 w-8" />
        <p>
          {t(
            includeManualPayments ? 'noRevenueDataWithManual' : 'noRevenueData',
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{
            top: 10,
            right: 10,
            left: 0,
            bottom: 0,
          }}
        >
          <defs>
            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) =>
              `${(value / 1000).toFixed(0)}k${currencySymbol}`
            }
          />
          <Tooltip
            content={({
              active,
              payload,
              label,
            }: TooltipContentProps<ValueType, NameType>) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-background rounded-lg border p-3 shadow-md">
                    <p className="font-medium">{label}</p>
                    <p className="text-muted-foreground text-sm">
                      {t(
                        includeManualPayments
                          ? 'revenueAbbrevWithManual'
                          : 'revenueAbbrev',
                      )}
                      : {formatCurrency(payload[0].value as number, currency)}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {t(
                        includeManualPayments
                          ? 'paymentsCountWithManual'
                          : 'paymentsCount',
                        {
                          count: payload[0].payload.payments,
                        },
                      )}
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
}
