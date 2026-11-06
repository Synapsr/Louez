"use client";

import { cn } from "@louez/utils";

import { useFormatMoney } from "@/hooks/use-format-money";

import { formatSignedAmount } from "./util.finances";

interface FinancesMovementAmountProps {
  /** Signed: positive came in, negative went out. */
  amount: number;
  /** A row outside the totals (pending, held…) is toned down. */
  counted?: boolean;
  className?: string;
}

/**
 * Money in reads in a quiet green; money out stays neutral — a refund is a
 * normal day at the till, not an error, so it is never red.
 */
export const FinancesMovementAmount = ({
  amount,
  counted = true,
  className,
}: FinancesMovementAmountProps) => {
  const formatMoney = useFormatMoney();

  return (
    <span
      className={cn(
        "whitespace-nowrap tabular-nums",
        !counted ? "text-muted-foreground" : amount > 0 ? "text-success" : "text-foreground",
        className,
      )}
    >
      {formatSignedAmount(amount, formatMoney)}
    </span>
  );
};
