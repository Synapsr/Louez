import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  FileTextIcon,
  PackageIcon,
  XCircleIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import {
  RESERVATION_STATUS_TONE_CLASS,
  type ReservationStatus,
} from "@/components/storefront/account/reservation-status.constants";

interface ReservationStatusCardProps {
  status: ReservationStatus;
  cancelledRequest?: boolean;
  isRentalPaid: boolean;
  /** Payment is the next step (confirmed, unpaid, Stripe active). */
  paymentRequired: boolean;
  /** Where the store's answer will land. Named in the pending copy. */
  customerEmail: string;
}

const STATUS_ICON: Record<ReservationStatus, typeof ClockIcon> = {
  pending: ClockIcon,
  confirmed: CheckCircle2Icon,
  ongoing: PackageIcon,
  completed: CheckCircle2Icon,
  cancelled: XCircleIcon,
  rejected: XCircleIcon,
  quote: FileTextIcon,
  declined: XCircleIcon,
};

/**
 * Status disc, one title, one line: where the reservation stands and what
 * happens next. Sits in the page's status bar, so it brings no card of its own.
 */
export const ReservationStatusCard = ({
  status,
  cancelledRequest = false,
  isRentalPaid,
  paymentRequired,
  customerEmail,
}: ReservationStatusCardProps) => {
  const t = useTranslations("storefront.account");
  const allSet = status === "confirmed" && isRentalPaid;

  const Icon = paymentRequired ? AlertCircleIcon : STATUS_ICON[status];
  const toneClass = paymentRequired
    ? "bg-warning/12 text-warning"
    : allSet
      ? "bg-success/12 text-success"
      : RESERVATION_STATUS_TONE_CLASS[status];

  const title = paymentRequired
    ? t("paymentRequired")
    : allSet
      ? t("status.allSet")
      : status === "pending"
        ? t("status.pendingFull")
        : cancelledRequest
          ? t("cancellation.cancelled")
          : t(`status.${status}`);

  const description = paymentRequired
    ? t("confirmedAwaitingPayment")
    : allSet
      ? t("status.allSetDescription")
      : cancelledRequest
        ? t("cancellation.done")
        : t(`status.${status}Description`);

  // Waiting on the store is the one state where the customer has nothing to do
  // and no date to look at, so the card leads with where the answer will land
  // and leaves the fallback — cancelling — to the line under it.
  const nextStep =
    status === "pending" && !paymentRequired
      ? t("status.pendingNextStep", { email: customerEmail })
      : null;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        aria-hidden
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5",
          toneClass,
        )}
      >
        <Icon />
      </div>
      <div className="min-w-0">
        <p className="font-semibold leading-snug">{title}</p>
        {nextStep ? <p className="text-pretty text-sm text-muted-foreground">{nextStep}</p> : null}
        <p className="text-pretty text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
};
