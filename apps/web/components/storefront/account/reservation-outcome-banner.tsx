import { CheckCircle2Icon, ClockIcon, ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@louez/ui";

import type { ReservationOutcomeEvent } from "@/lib/customer-auth/util.account-redirect";
import type { ReservationPaymentStatus } from "@/lib/reservations/util.payment-status";

interface ReservationOutcomeBannerProps {
  /** From `?event=`, already whitelisted by the page. */
  event: ReservationOutcomeEvent | null;
  paymentStatus: ReservationPaymentStatus;
}

/** `requested` is left out: the pending status bar already says it, and better. */
type BannerKey = Exclude<ReservationOutcomeEvent, "requested"> | "processing";

const TONE: Record<BannerKey, "success" | "info"> = {
  paid: "success",
  payment_received: "success",
  deposit_authorized: "success",
  processing: "info",
};

const ICON: Record<BannerKey, typeof CheckCircle2Icon> = {
  paid: CheckCircle2Icon,
  payment_received: CheckCircle2Icon,
  deposit_authorized: ShieldCheckIcon,
  processing: ClockIcon,
};

/**
 * The "moment" banner after a payment or a deposit authorisation: what just
 * happened, when the status bar below cannot say it. `event=paid` with no
 * completed payment yet reads as "processing" (webhook lag).
 */
export const ReservationOutcomeBanner = ({
  event,
  paymentStatus,
}: ReservationOutcomeBannerProps) => {
  const t = useTranslations("storefront.account.outcome");

  if (!event || event === "requested") return null;

  const key: BannerKey = event === "paid" && paymentStatus !== "paid" ? "processing" : event;
  const Icon = ICON[key];

  return (
    <Alert variant={TONE[key]} className="rounded-2xl" data-slot="reservation-outcome">
      <Icon />
      <AlertTitle>{t(`${key}.title`)}</AlertTitle>
      <AlertDescription>{t(`${key}.description`)}</AlertDescription>
    </Alert>
  );
};
