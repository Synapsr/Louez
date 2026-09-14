"use client";

import { CalendarIcon, ClockIcon } from "lucide-react";
import { useLocale } from "next-intl";

import { cn } from "@louez/utils";

import { formatStoreDate } from "@/lib/utils/store-date";

interface DateTimeFieldProps {
  label: string;
  /** Instant of the committed period; the field shows its store-timezone day and time. */
  value?: Date;
  placeholder: string;
  timezone?: string;
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
  className,
}: DateTimeFieldProps) => {
  const locale = useLocale();

  return (
    <span className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          "flex h-12 items-center gap-2 rounded-lg border bg-background px-3 transition-[color,background-color,box-shadow] duration-200 lg:h-11",
          value ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {value ? formatStoreDate(value, timezone, "d MMM", locale) : placeholder}
        </span>
        {value ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-sm tabular-nums text-muted-foreground">
            <ClockIcon className="size-3.5" aria-hidden />
            {formatStoreDate(value, timezone, "TIME_ONLY", locale)}
          </span>
        ) : null}
      </span>
    </span>
  );
};
