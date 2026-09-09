"use client";

import type { ComponentProps, ReactElement } from "react";
import { CalendarIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import { formatRentalPeriod } from "@/lib/utils/store-date";

import type { RentalPeriodValue } from "./core/types";

interface PeriodChipProps extends Omit<ComponentProps<typeof Button>, "children" | "render"> {
  period: RentalPeriodValue | null;
  timezone?: string;
  /** Compose with a trigger primitive: `render={<PopoverTrigger />}`. */
  render?: ReactElement;
}

/**
 * Compact period chip: the current period ("3–5 mars") or an invitation to
 * pick one. Opens the picker wherever it sits (header, catalog, cart).
 */
export const PeriodChip = ({ period, timezone, render, className, ...props }: PeriodChipProps) => {
  const t = useTranslations("storefront.dateSelection");
  const locale = useLocale();

  return (
    <Button
      variant="outline"
      className={cn(
        "h-9 gap-2 rounded-full bg-background px-3 text-sm font-medium pointer-coarse:h-11",
        !period && "text-muted-foreground",
        className,
      )}
      render={render}
      {...props}
    >
      <CalendarIcon className="size-4 text-muted-foreground" aria-hidden />
      <span className="truncate">
        {period
          ? formatRentalPeriod(period.start, period.end, { timezone, locale })
          : t("chooseDates")}
      </span>
    </Button>
  );
};
