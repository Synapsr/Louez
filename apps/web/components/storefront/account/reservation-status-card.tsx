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
  isRentalPaid: boolean;
  /** Payment is the next step (confirmed, unpaid, Stripe active). */
  paymentRequired: boolean;
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

/** Status disc, one title, one line: where the reservation stands. Sits in the page's status bar, so it brings no card of its own. */
export const ReservationStatusCard = ({
  status,
  isRentalPaid,
  paymentRequired,
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
        : t(`status.${status}`);

  const description = paymentRequired
    ? t("confirmedAwaitingPayment")
    : allSet
      ? t("status.allSetDescription")
      : t(`status.${status}Description`);

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
        <p className="text-pretty text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
};
