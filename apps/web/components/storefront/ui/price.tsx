"use client";

import { cn } from "@louez/utils";

import { useFormatMoney } from "@/hooks/use-format-money";

type PriceSize = "sm" | "md" | "lg" | "xl";
type PriceTone = "default" | "primary";

interface PriceProps {
  amount: number;
  /**
   * Price before discount, struck through. The caller applies the store's
   * display cap (`useDiscountVisibility`) before passing it: above the cap
   * only the discounted price shows.
   */
  compareAt?: number | null;
  /** Billing period label ("jour", "3 jours"); rendered as "/ jour". */
  per?: string | null;
  /** Plain suffix without the slash ("Forfait", "TTC"). */
  label?: string | null;
  size?: PriceSize;
  /** `primary` is for the one total that matters on the screen. */
  tone?: PriceTone;
  className?: string;
}

const AMOUNT_CLASS_NAMES: Record<PriceSize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
  xl: "text-2xl",
};

const SUFFIX_CLASS_NAMES: Record<PriceSize, string> = {
  sm: "text-xs",
  md: "text-xs",
  lg: "text-sm",
  xl: "text-sm",
};

/**
 * The one way a price is written on the storefront: store currency, visitor
 * locale, tabular digits, muted suffix. Cards use `md`, the product summary
 * `xl`, cart lines `sm`.
 */
export const Price = ({
  amount,
  compareAt,
  per,
  label,
  size = "md",
  tone = "default",
  className,
}: PriceProps) => {
  const formatMoney = useFormatMoney();
  const suffix = per ? `/ ${per}` : label;

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-baseline gap-x-1 tabular-nums",
        tone === "primary" ? "text-primary" : "text-foreground",
        className,
      )}
      data-slot="price"
    >
      {compareAt != null && compareAt > amount ? (
        <s className={cn("font-normal text-muted-foreground", SUFFIX_CLASS_NAMES[size])}>
          {formatMoney(compareAt)}
        </s>
      ) : null}
      <data value={amount} className={cn("font-semibold tracking-tight", AMOUNT_CLASS_NAMES[size])}>
        {formatMoney(amount)}
      </data>
      {suffix ? (
        <span className={cn("font-normal text-muted-foreground", SUFFIX_CLASS_NAMES[size])}>
          {suffix}
        </span>
      ) : null}
    </span>
  );
};
