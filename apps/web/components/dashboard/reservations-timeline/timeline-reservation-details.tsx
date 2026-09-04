"use client";

import { useTranslations } from "next-intl";

import { DeliveryTruckIcon, ExternalLinkIcon, ReturnTruckIcon } from "@louez/ui/icons";
import { cn, formatCurrency, formatDateShort, formatTime } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";

import { getTimelineRentalAmount, type TimelineReservation } from "./timeline-utils";

interface TimelineReservationDetailsProps {
  reservation: TimelineReservation;
  currency: string;
  locale: string;
}

export const TimelineReservationDetails = ({
  reservation,
  currency,
  locale,
}: TimelineReservationDetailsProps) => {
  const t = useTranslations("dashboard.reservations");
  const hasDelivery = Boolean(
    reservation.outboundDeliveryAddress || reservation.returnDeliveryAddress,
  );

  return (
    <>
      {reservation.items && reservation.items.length > 0 && (
        <div className="border-t pt-4 md:pt-1.5">
          <ul className="-mx-1 space-y-1 text-sm md:space-y-0.5 md:text-xs">
            {reservation.items.map((item) => {
              const content = (
                <>
                  <ProductImage
                    src={item.imageUrl}
                    alt={item.name}
                    containerClassName="w-10 shrink-0 rounded md:w-8"
                    sizes="(max-width: 767px) 40px, 32px"
                  />
                  <span className="text-foreground min-w-0 flex-1 truncate">{item.name}</span>
                  {item.quantity > 1 && (
                    <span className="text-muted-foreground shrink-0 font-semibold tabular-nums">
                      ×{item.quantity}
                    </span>
                  )}
                </>
              );
              const rowClassName = "flex items-center gap-2 rounded-md px-1 py-1.5 md:py-0.5";

              if (!item.productId) {
                return (
                  <li key={item.name} className={rowClassName}>
                    {content}
                    <span aria-hidden="true" className="h-3 w-3 shrink-0" />
                  </li>
                );
              }

              return (
                <li key={item.productId}>
                  <a
                    href={`/dashboard/products/${encodeURIComponent(item.productId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      rowClassName,
                      "hover:bg-accent focus-visible:ring-ring group transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    )}
                  >
                    {content}
                    <ExternalLinkIcon className="text-muted-foreground h-3 w-3 shrink-0 opacity-60 transition-opacity md:opacity-0 md:group-hover:opacity-100" />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {hasDelivery && (
        <div className="text-muted-foreground space-y-2.5 border-t pt-4 text-sm md:space-y-1.5 md:pt-1.5 md:text-[11px]">
          {reservation.outboundDeliveryAddress && (
            <div className="space-y-0.5">
              <span className="text-muted-foreground/70 flex items-center gap-1">
                <DeliveryTruckIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0"
                  strokeWidth={1.75}
                />
                {t("deliveryAddressLabel")}
              </span>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(reservation.outboundDeliveryAddress)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:text-primary inline-flex items-start gap-1 font-medium"
              >
                <span>{reservation.outboundDeliveryAddress}</span>
                <ExternalLinkIcon className="mt-0.5 h-3 w-3 shrink-0" />
              </a>
            </div>
          )}
          {reservation.returnDeliveryAddress && (
            <div className="space-y-0.5">
              <span className="text-muted-foreground/70 flex items-center gap-1">
                <ReturnTruckIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0"
                  strokeWidth={1.75}
                />
                {t("returnAddressLabel")}
              </span>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(reservation.returnDeliveryAddress)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:text-primary inline-flex items-start gap-1 font-medium"
              >
                <span>{reservation.returnDeliveryAddress}</span>
                <ExternalLinkIcon className="mt-0.5 h-3 w-3 shrink-0" />
              </a>
            </div>
          )}
        </div>
      )}

      <div className="text-muted-foreground space-y-2 border-t pt-4 text-sm md:space-y-1 md:pt-1.5 md:text-[11px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground/70">{t("periodStart")}</span>
          <span>
            {formatDateShort(reservation.startDate, locale)}{" "}
            <span className="tabular-nums">{formatTime(reservation.startDate, locale)}</span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground/70">{t("periodEnd")}</span>
          <span>
            {formatDateShort(reservation.endDate, locale)}{" "}
            <span className="tabular-nums">{formatTime(reservation.endDate, locale)}</span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 pt-0.5 font-medium">
          <span className="text-muted-foreground/70">{t("totalAmount")}</span>
          <span className="text-foreground tabular-nums">
            {formatCurrency(getTimelineRentalAmount(reservation), currency, locale)}
          </span>
        </div>
      </div>
    </>
  );
};
