"use client";

import { type ComponentProps, useState } from "react";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@louez/ui";
import { cn } from "@louez/utils";

import { Price } from "@/components/storefront/ui/price";
import { useStoreTimezone } from "@/contexts/store-context";
import { useFormatLocale } from "@/hooks/use-format-locale";
import { formatRentalPeriod } from "@/lib/utils/store-date";

import { CheckoutOrderSummary } from "./checkout-order-summary";

type CheckoutSummaryBarProps = Omit<
  ComponentProps<typeof CheckoutOrderSummary>,
  "variant" | "className"
>;

/**
 * Phone header of the checkout: one line with the total and the dates, the
 * full summary behind a disclosure. Hidden at `lg`, where the sticky card
 * takes over.
 */
export const CheckoutSummaryBar = (props: CheckoutSummaryBarProps) => {
  const t = useTranslations("storefront.checkout");
  const { intl: formatLocale } = useFormatLocale();
  const timezone = useStoreTimezone();
  const [open, setOpen] = useState(false);
  const { totals, items } = props;

  const periods = [
    ...new Map(
      items.map((item) => [`${item.startDate}|${item.endDate}`, item] as const),
    ).values(),
  ];
  const dates =
    periods.length === 1
      ? new Intl.DateTimeFormat(formatLocale, { day: "numeric", month: "short" }).formatRange(
          new Date(periods[0].startDate),
          new Date(periods[0].endDate),
        )
      : periods
          .map((item) =>
            formatRentalPeriod(new Date(item.startDate), new Date(item.endDate), {
              timezone,
              locale: formatLocale,
              style: "long",
            }),
          )
          .join(" · ");

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-2xl bg-card shadow-card lg:hidden"
    >
      <CollapsibleTrigger className="flex min-h-14 w-full items-center gap-3 px-4 text-left">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">
            {t("summary")} · <Price amount={totals.total} size="sm" />
          </span>
          {dates && <span className="truncate text-xs text-muted-foreground">{dates}</span>}
        </div>
        <span className="text-xs text-muted-foreground">
          {open ? t("summaryBar.hide") : t("summaryBar.show")}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <CheckoutOrderSummary {...props} variant="bare" className="border-t px-4 pt-4 pb-4" />
      </CollapsiblePanel>
    </Collapsible>
  );
};
