"use client";

import { type ComponentProps, useState } from "react";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@louez/ui";
import { cn } from "@louez/utils";

import { Price } from "@/components/storefront/ui/price";
import { useFormatLocale } from "@/hooks/use-format-locale";

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
  const [open, setOpen] = useState(false);
  const { totals, globalStartDate, globalEndDate } = props;

  const dates =
    globalStartDate && globalEndDate
      ? new Intl.DateTimeFormat(formatLocale, { day: "numeric", month: "short" }).formatRange(
          new Date(globalStartDate),
          new Date(globalEndDate),
        )
      : null;

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
