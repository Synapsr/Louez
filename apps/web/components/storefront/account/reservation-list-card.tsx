import { AlertCircleIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";
import { ReservationStatusBadge } from "@/components/storefront/account/reservation-status-badge";
import {
  isClosedReservationStatus,
  type ReservationStatus,
} from "@/components/storefront/account/reservation-status.constants";
import { Price } from "@/components/storefront/ui/price";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import type { ReservationRequiredAction } from "@/lib/reservations/util.reservation-actions";

export interface ReservationListItem {
  id: string;
  number: string;
  status: ReservationStatus;
  /** Already formatted in the store timezone. */
  periodLabel: string;
  itemCount: number;
  products: { name: string; imageUrl: string | null }[];
  totalAmount: number;
  requiredAction: ReservationRequiredAction | null;
}

interface ReservationListCardProps {
  reservation: ReservationListItem;
}

/**
 * One row of the account list, built on the product card's language: the same
 * resting `shadow-card`, the same inset image, and the same answer to the
 * pointer — the hairline darkens and the photo zooms, nothing lifts. Title,
 * then one muted line of number, period and count; the whole card is the link.
 */
export const ReservationListCard = ({ reservation }: ReservationListCardProps) => {
  const t = useTranslations("storefront.account");
  const closed = isClosedReservationStatus(reservation.status);
  const title = reservation.products.map((product) => product.name).join(", ");

  return (
    <StorefrontLink
      href={`/account/reservations/${reservation.id}`}
      className={cn(
        "group relative flex flex-col rounded-2xl bg-card p-1 shadow-card outline-none",
        "transition-shadow duration-150 hover:ring-1 hover:ring-foreground/12",
        "focus-visible:ring-2 focus-visible:ring-ring",
        closed && "opacity-60",
      )}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Inset image, its radius concentric with the card's (16px − 4px of
            padding). Kept even without a photo, so every row lines up. */}
        <div className="relative aspect-4/3 w-20 shrink-0 overflow-hidden rounded-xl bg-muted shadow-[0_0_1px_0.75px_var(--color-border)] sm:w-24">
          <ProductImage
            src={reservation.products[0]?.imageUrl ?? undefined}
            alt=""
            sizes="96px"
            inset={false}
            containerClassName="absolute inset-0 rounded-none"
            className="motion-safe:transition-[opacity,scale] motion-safe:duration-400 motion-safe:ease-out motion-safe:group-hover:scale-[1.04]"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium leading-snug">{title}</h3>
            <ReservationStatusBadge status={reservation.status} className="shrink-0" />
          </div>
          <p className="truncate text-sm text-muted-foreground">
            <span className="tabular-nums">#{reservation.number}</span>
            <span aria-hidden> · </span>
            {reservation.periodLabel}
            <span aria-hidden> · </span>
            {t("itemCount", { count: reservation.itemCount })}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1 pe-2 sm:gap-2 sm:pe-3">
          <Price amount={reservation.totalAmount} size="md" />
          <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
        </div>
      </div>

      {reservation.requiredAction ? (
        <p className="mt-1 flex items-center gap-2 rounded-xl bg-warning/12 px-3 py-2 text-sm font-medium text-warning">
          <AlertCircleIcon aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0">{t(`actionRequired.${reservation.requiredAction}`)}</span>
        </p>
      ) : null}
    </StorefrontLink>
  );
};
