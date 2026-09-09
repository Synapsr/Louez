"use client";

import { CalendarIcon, ClockIcon } from "lucide-react";
import { useLocale } from "next-intl";

import { cn } from "@louez/utils";

import { formatStoreDate } from "@/lib/utils/store-date";

type DateTimeFieldSize = "default" | "compact";

interface DateTimeFieldProps {
  label: string;
  /** Instant of the committed period; the field shows its store-timezone day and time. */
  value?: Date;
  placeholder: string;
  timezone?: string;
  size?: DateTimeFieldSize;
  className?: string;
}

/**
 * One half of the period fields ("Retrait" / "Retour"): day on the left,
 * time on the right. Presentational: the parent decides what a tap opens.
 */
export const DateTimeField = ({
  label,
  value,
  placeholder,
  timezone,
  size = "default",
  className,
}: DateTimeFieldProps) => {
  const locale = useLocale();
  const compact = size === "compact";

  return (
    <span className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span
        className={cn("font-medium text-muted-foreground", compact ? "text-[11px]" : "text-xs")}
      >
        {label}
      </span>
      <span
        className={cn(
          "flex items-center gap-2 rounded-lg border bg-background px-3 transition-[color,background-color,box-shadow] duration-200",
          compact ? "h-10" : "h-12 lg:h-11",
          value ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span
          className={cn("min-w-0 flex-1 truncate font-medium", compact ? "text-xs" : "text-sm")}
        >
          {value ? formatStoreDate(value, timezone, "d MMM", locale) : placeholder}
        </span>
        {value ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground",
              compact ? "text-xs" : "text-sm",
            )}
          >
            <ClockIcon className="size-3.5" aria-hidden />
            {formatStoreDate(value, timezone, "TIME_ONLY", locale)}
          </span>
        ) : null}
      </span>
    </span>
  );
};
