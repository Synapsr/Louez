import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";

import {
  RESERVATION_STATUS_BADGE_VARIANT,
  type ReservationStatus,
} from "@/components/storefront/account/reservation-status.constants";

interface ReservationStatusBadgeProps {
  status: ReservationStatus;
  className?: string;
}

/** The status word in its token colour; the same one on the list and the page. */
export const ReservationStatusBadge = ({ status, className }: ReservationStatusBadgeProps) => {
  const t = useTranslations("storefront.account.status");

  return (
    <Badge variant={RESERVATION_STATUS_BADGE_VARIANT[status]} className={className}>
      {t(status)}
    </Badge>
  );
};
