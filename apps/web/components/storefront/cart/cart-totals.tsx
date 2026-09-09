"use client";

import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { Price } from "@/components/storefront/ui/price";
import type { CartSummary } from "@/contexts/cart-context";
import { useFormatMoney } from "@/hooks/use-format-money";

interface CartTotalsProps {
  summary: CartSummary;
  className?: string;
}

/**
 * Subtotal, advertised savings, deposit and the total that counts. The
 * deposit is a hold, so it sits outside the total.
 */
export const CartTotals = ({ summary, className }: CartTotalsProps) => {
  const t = useTranslations("storefront.cart");
  const formatMoney = useFormatMoney();
  const { savings, originalSubtotal } = summary.displayableSavings;
  const showSavings = savings > 0;

  return (
    <dl className={cn("flex flex-col gap-1.5 text-sm", className)} data-slot="cart-totals">
      {showSavings ? (
        <>
          <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
            <dt>{t("subtotal")}</dt>
            <dd className="tabular-nums line-through">{formatMoney(originalSubtotal)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-success">
            <dt>{t("discount")}</dt>
            <dd className="tabular-nums">−{formatMoney(savings)}</dd>
          </div>
        </>
      ) : (
        <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
          <dt>{t("subtotal")}</dt>
          <dd className="tabular-nums">{formatMoney(summary.subtotal)}</dd>
        </div>
      )}
      {summary.deposit > 0 ? (
        <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
          <dt>
            {t("deposit")}
            <span className="ml-1 text-xs">· {t("depositHold")}</span>
          </dt>
          <dd className="tabular-nums">{formatMoney(summary.deposit)}</dd>
        </div>
      ) : null}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-2">
        <dt className="text-base font-medium">{t("total")}</dt>
        <dd>
          <Price amount={summary.total} size="lg" tone="primary" />
        </dd>
      </div>
    </dl>
  );
};
