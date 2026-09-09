"use client";

import { useEffect, useRef } from "react";

import { CheckCircle2Icon, ClockIcon, SendIcon, ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@louez/ui";

import { useCart } from "@/contexts/cart-context";
import type { ReservationOutcomeEvent } from "@/lib/customer-auth/util.account-redirect";
import type { ReservationPaymentStatus } from "@/lib/reservations/util.payment-status";

interface ReservationOutcomeBannerProps {
  /** From `?event=`, already whitelisted by the page. */
  event: ReservationOutcomeEvent | null;
  paymentStatus: ReservationPaymentStatus;
}

type OutcomeKey = ReservationOutcomeEvent | "processing";

const TONE: Record<OutcomeKey, "success" | "info"> = {
  paid: "success",
  payment_received: "success",
  deposit_authorized: "success",
  requested: "info",
  processing: "info",
};

const ICON: Record<OutcomeKey, typeof CheckCircle2Icon> = {
  paid: CheckCircle2Icon,
  payment_received: CheckCircle2Icon,
  deposit_authorized: ShieldCheckIcon,
  requested: SendIcon,
  processing: ClockIcon,
};

/**
 * The "moment" banner after a checkout, a payment request or a deposit
 * authorisation: what just happened and what comes next. `event=paid`
 * with no completed payment yet reads as "processing" (webhook lag).
 * A fresh checkout (`paid` or `requested`) also clears the cart, once.
 */
export const ReservationOutcomeBanner = ({
  event,
  paymentStatus,
}: ReservationOutcomeBannerProps) => {
  const t = useTranslations("storefront.account.outcome");
  const { clearCart } = useCart();
  const hasCleared = useRef(false);

  useEffect(() => {
    if (hasCleared.current) return;
    if (event === "paid" || event === "requested") {
      hasCleared.current = true;
      clearCart();
    }
  }, [event, clearCart]);

  if (!event) return null;

  const key: OutcomeKey = event === "paid" && paymentStatus !== "paid" ? "processing" : event;
  const Icon = ICON[key];

  return (
    <Alert variant={TONE[key]} className="rounded-2xl" data-slot="reservation-outcome">
      <Icon />
      <AlertTitle>{t(`${key}.title`)}</AlertTitle>
      <AlertDescription>{t(`${key}.description`)}</AlertDescription>
    </Alert>
  );
};
