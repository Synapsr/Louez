import type { ReactNode } from "react";
import { DashboardTrendBadge } from "@/components/dashboard/shared/dashboard-trend-badge";

export const StatStripItem = ({
  label,
  value,
  subtitle,
  trend,
}: {
  label: string;
  value: ReactNode;
  subtitle: string;
  trend?: number | null;
}) => {
  return (
    <div className="flex flex-col gap-1 p-4 sm:p-5">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-lg leading-tight font-semibold tracking-tight tabular-nums sm:text-xl">
          {value}
        </span>
        <DashboardTrendBadge trend={trend} />
      </div>
      <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
    </div>
  );
};
