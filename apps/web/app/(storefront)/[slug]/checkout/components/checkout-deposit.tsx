"use client";

import { CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";

import { Tooltip, TooltipPopup, TooltipTrigger } from "@louez/ui";

import { useFormatMoney } from "@/hooks/use-format-money";

import type { ReservationMode } from "../checkout.types";

export const CheckoutDeposit = ({
  amount,
  reservationMode,
}: {
  amount: number;
  reservationMode: ReservationMode;
}) => {
  const t = useTranslations("storefront.checkout");
  const formatMoney = useFormatMoney();

  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        {t("depositLabel")}
        <Tooltip>
          <TooltipTrigger
            type="button"
            aria-label={t("depositLabel")}
            className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CircleHelp aria-hidden="true" className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup className="max-w-64">
            {reservationMode === "payment"
              ? t("depositAuthorizationInfo")
              : t("depositInfo", { amount: formatMoney(amount) })}
          </TooltipPopup>
        </Tooltip>
      </span>
      <span className="shrink-0 tabular-nums">{formatMoney(amount)}</span>
    </div>
  );
};
