"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@louez/ui";
import { cn } from "@louez/utils";

import { parsePeriod, type Period, PERIODS } from "./period";

interface UnifiedPeriodFilterProps {
  className?: string;
  period?: Period;
  /** Supplied by local previews; period changes and refresh stay off the router. */
  onPeriodChange?: (period: Period) => void;
}

export const UnifiedPeriodFilter = ({
  className,
  period,
  onPeriodChange,
}: UnifiedPeriodFilterProps) => {
  const t = useTranslations("dashboard.analytics");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPeriod = period ?? parsePeriod(searchParams.get("period") ?? undefined);

  const periods = PERIODS.map((value) => ({ value, label: t(`period.${value}`) }));

  const handlePeriodChange = (value: Period) => {
    if (onPeriodChange) {
      onPeriodChange(value);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    // The filter lives in the shared layout, so it has to stay on whichever
    // analytics sub-page is currently open.
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Segmented control (desktop) */}
      <div className="bg-muted hidden items-center gap-0.5 rounded-lg p-0.5 md:flex">
        {periods.map((period) => (
          <Button
            key={period.value}
            data-analytics-period={period.value}
            size="sm"
            variant={currentPeriod === period.value ? "default" : "ghost"}
            onClick={() => handlePeriodChange(period.value)}
          >
            {period.label}
          </Button>
        ))}
      </div>

      {/* Select (mobile) */}
      <Select
        value={currentPeriod}
        modal={onPeriodChange ? false : undefined}
        onValueChange={(value) => {
          const nextPeriod = PERIODS.find((period) => period === value);
          if (nextPeriod) handlePeriodChange(nextPeriod);
        }}
      >
        <SelectTrigger className="flex-1 md:hidden">
          <SelectValue>
            {periods.find((period) => period.value === currentPeriod)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent finalFocus={onPeriodChange ? false : undefined}>
          {periods.map((period) => (
            <SelectItem key={period.value} value={period.value} label={period.label}>
              {period.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="icon"
        onClick={() => (onPeriodChange ? onPeriodChange(currentPeriod) : router.refresh())}
        aria-label={t("refresh")}
      >
        <RefreshCw />
      </Button>
    </div>
  );
};
