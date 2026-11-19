import { cn, formatCurrency } from "@louez/utils";

export const DEFAULT_POLISH_VAT_RATE = 23;

export const calculateGrossFromNet = (
  netAmount: number,
  vatRatePercent: number = DEFAULT_POLISH_VAT_RATE,
): number => {
  if (!Number.isFinite(netAmount)) return 0;
  const safeRate = Number.isFinite(vatRatePercent) && vatRatePercent >= 0 ? vatRatePercent : 0;
  return Math.round(netAmount * (1 + safeRate / 100) * 100) / 100;
};

export interface NetGrossPriceProps {
  amount: number;
  currency?: string;
  locale?: string;
  suffix?: string;
  prefix?: string;
  vatRate?: number;
  align?: "left" | "right";
  size?: "sm" | "md" | "lg";
  netClassName?: string;
  grossClassName?: string;
  className?: string;
}

export const NetGrossPrice = ({
  amount,
  currency = "PLN",
  locale,
  suffix = "",
  prefix = "",
  vatRate = DEFAULT_POLISH_VAT_RATE,
  align = "right",
  size = "md",
  netClassName,
  grossClassName,
  className,
}: NetGrossPriceProps) => {
  const grossAmount = calculateGrossFromNet(amount, vatRate);

  return (
    <span
      className={cn(
        "inline-flex flex-col leading-tight tabular-nums",
        align === "right" ? "items-end text-right" : "items-start text-left",
        className,
      )}
    >
      <span
        className={cn(
          size === "lg"
            ? "text-base font-bold sm:text-lg"
            : size === "sm"
              ? "text-xs font-semibold"
              : "text-sm font-semibold",
          netClassName,
        )}
      >
        {prefix}
        {formatCurrency(amount, currency, locale)}
        {suffix} netto
      </span>
      <span
        className={cn(
          "font-normal text-muted-foreground",
          size === "lg" ? "text-xs" : "text-[11px]",
          grossClassName,
        )}
      >
        {prefix}
        {formatCurrency(grossAmount, currency, locale)}
        {suffix} brutto
      </span>
    </span>
  );
};
