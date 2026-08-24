"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  Badge,
  Button,
  Drawer,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@louez/ui";
import {
  ChevronLeftIcon,
  DeliveryTruckIcon,
  ExternalLinkIcon,
  ReturnTruckIcon,
  TriangleAlertIcon,
} from "@louez/ui/icons";
import { cn, formatCurrency } from "@louez/utils";

import { getReservationDetailHref } from "@/lib/product-analytics/reservation-analytics";

import { TimelineReservationDetails } from "./timeline-reservation-details";
import { getTimelineRentalAmount, type TimelineReservation } from "./timeline-utils";

type KnownStatus =
  | "pending"
  | "confirmed"
  | "ongoing"
  | "completed"
  | "cancelled"
  | "rejected"
  | "quote"
  | "declined";

const BAR_COLORS: Record<KnownStatus, string> = {
  pending:
    "bg-reservation-pending-soft text-reservation-pending hover:brightness-[0.97] dark:hover:brightness-[1.2]",
  confirmed:
    "bg-reservation-confirmed-soft text-reservation-confirmed hover:brightness-[0.97] dark:hover:brightness-[1.2]",
  ongoing:
    "bg-reservation-ongoing-soft text-reservation-ongoing hover:brightness-[0.97] dark:hover:brightness-[1.2]",
  completed:
    "bg-reservation-completed-soft text-reservation-completed hover:brightness-[0.97] dark:hover:brightness-[1.2]",
  cancelled:
    "bg-reservation-cancelled-soft text-reservation-cancelled hover:brightness-[0.97] dark:hover:brightness-[1.2]",
  rejected:
    "bg-reservation-rejected-soft text-reservation-rejected hover:brightness-[0.97] dark:hover:brightness-[1.2]",
  quote:
    "bg-reservation-quote-soft text-reservation-quote hover:brightness-[0.97] dark:hover:brightness-[1.2]",
  declined:
    "bg-reservation-declined-soft text-reservation-declined hover:brightness-[0.97] dark:hover:brightness-[1.2]",
};

const DOT_COLORS: Record<KnownStatus, string> = {
  pending: "bg-reservation-pending",
  confirmed: "bg-reservation-confirmed",
  ongoing: "bg-reservation-ongoing",
  completed: "bg-reservation-completed",
  cancelled: "bg-reservation-cancelled",
  rejected: "bg-reservation-rejected",
  quote: "bg-reservation-quote",
  declined: "bg-reservation-declined",
};

const BADGE_VARIANTS: Record<
  KnownStatus,
  "pending" | "progress" | "submitted" | "success" | "failed" | "expired"
> = {
  pending: "pending",
  confirmed: "success",
  ongoing: "progress",
  completed: "success",
  cancelled: "failed",
  rejected: "failed",
  quote: "submitted",
  declined: "expired",
};

export function getTimelineStatus(status: string | null): KnownStatus {
  return (status ?? "pending") as KnownStatus;
}

export function getStatusDotClass(status: string | null): string {
  return DOT_COLORS[getTimelineStatus(status)] ?? DOT_COLORS.pending;
}

interface TimelineReservationBarProps {
  reservation: TimelineReservation;
  currency: string;
  /** Persists the timeline viewport before navigating to reservation details. */
  onBeforeNavigate?: () => void;
  /** Dashboard path the reservation detail page should send the user back to. */
  returnTo?: string | null;
  /** Flags an overbooked placement (no free unit lane was available) */
  isConflict?: boolean;
  /** Keeps the label visible while its reservation intersects the horizontal viewport */
  isLabelSticky?: boolean;
  /** Left edge reserved by a sticky timeline column */
  stickyLabelOffset?: number;
  /** Signals that the reservation started before the visible timeline */
  continuesBeforeViewport?: boolean;
  style?: React.CSSProperties;
}

/**
 * A single reservation bar on a unit lane. Opens the reservation detail in the
 * current tab so the calendar follows the dashboard's usual navigation behavior.
 */
export function TimelineReservationBar({
  reservation,
  currency,
  onBeforeNavigate,
  returnTo,
  isConflict = false,
  isLabelSticky = false,
  stickyLabelOffset = 0,
  continuesBeforeViewport = false,
  style,
}: TimelineReservationBarProps) {
  const t = useTranslations("dashboard.calendar");
  const status = getTimelineStatus(reservation.status);
  const colorClass = BAR_COLORS[status] ?? BAR_COLORS.pending;
  const reservationHref = getReservationDetailHref(
    reservation.id,
    "reservations_timeline",
    returnTo,
  );
  const rentalPrice = formatCurrency(getTimelineRentalAmount(reservation), currency);

  const hasOutboundDelivery = Boolean(reservation.outboundDeliveryAddress);
  const hasReturnDelivery = Boolean(reservation.returnDeliveryAddress);

  const barLabel = (
    <span
      className={cn(
        "flex h-full w-fit max-w-full items-center gap-1 px-2",
        isLabelSticky && "sticky",
      )}
      style={isLabelSticky ? { left: stickyLabelOffset } : undefined}
    >
      {continuesBeforeViewport && (
        <ChevronLeftIcon aria-hidden="true" className="h-3 w-3 shrink-0 opacity-60" />
      )}
      {isConflict && (
        <TriangleAlertIcon aria-hidden="true" className="text-destructive h-3 w-3 shrink-0" />
      )}
      {hasOutboundDelivery && (
        <span role="img" aria-label={t("logistics.delivery")} className="inline-flex shrink-0">
          <DeliveryTruckIcon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
        </span>
      )}
      {hasReturnDelivery && (
        <span role="img" aria-label={t("logistics.return")} className="inline-flex shrink-0">
          <ReturnTruckIcon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
        </span>
      )}
      <span className="truncate">{reservation.customerName}</span>
      {reservation.quantity > 1 && (
        <span className="shrink-0 opacity-70">×{reservation.quantity}</span>
      )}
      <span className="ms-auto hidden shrink-0 opacity-70 @min-[16rem]:inline">
        · {rentalPrice}
      </span>
    </span>
  );

  const barClassName = cn(
    "@container absolute z-5 overflow-hidden rounded-md text-xs font-medium transition-[filter]",
    isLabelSticky && "overflow-clip",
    "focus-visible:ring-ring focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none",
    "shadow-[0_0_0.5px_0.5px_currentColor] dark:shadow-[0_0_1px_0px_currentColor]",
    colorClass,
    isConflict && "ring-destructive/60 ring-1 ring-inset",
  );

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          delay={100}
          render={
            <Link
              href={reservationHref}
              onClick={onBeforeNavigate}
              className={cn(barClassName, "hidden md:block")}
              style={style}
            />
          }
        >
          {barLabel}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="min-w-52 space-y-2 p-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                {reservation.customerId ? (
                  <a
                    href={`/dashboard/customers/${encodeURIComponent(reservation.customerId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground hover:text-primary focus-visible:ring-ring group inline-flex max-w-full items-center gap-1 rounded-sm text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <span className="truncate">{reservation.customerName}</span>
                    <ExternalLinkIcon className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                  </a>
                ) : (
                  <p className="truncate text-sm font-semibold">{reservation.customerName}</p>
                )}
                <p className="text-muted-foreground/70 flex items-center gap-1.5 text-[11px]">
                  <span className="font-mono">#{reservation.number}</span>
                  {reservation.quantity > 1 && (
                    <span className="tabular-nums">×{reservation.quantity}</span>
                  )}
                </p>
              </div>
              <Badge variant={BADGE_VARIANTS[status]} className="mt-0.5 shrink-0">
                {t(`status.${status}`)}
              </Badge>
            </div>
            <TimelineReservationDetails reservation={reservation} currency={currency} />
          </div>
        </TooltipContent>
      </Tooltip>

      <Drawer position="bottom">
        <DrawerTrigger
          render={
            <button
              type="button"
              className={cn(barClassName, "text-start md:hidden")}
              style={style}
              onPointerDown={(event) => event.stopPropagation()}
            />
          }
        >
          {barLabel}
        </DrawerTrigger>
        <DrawerPopup showCloseButton>
          <DrawerHeader>
            <div className="flex items-start justify-between gap-3 pe-8">
              <div className="min-w-0 space-y-1">
                <DrawerTitle className="truncate">{reservation.customerName}</DrawerTitle>
                <DrawerDescription className="flex items-center gap-1.5">
                  <span className="font-mono">#{reservation.number}</span>
                  {reservation.quantity > 1 && (
                    <span className="tabular-nums">×{reservation.quantity}</span>
                  )}
                </DrawerDescription>
              </div>
              <Badge variant={BADGE_VARIANTS[status]} className="shrink-0">
                {t(`status.${status}`)}
              </Badge>
            </div>
          </DrawerHeader>
          <DrawerPanel className="space-y-2">
            <TimelineReservationDetails reservation={reservation} currency={currency} />
          </DrawerPanel>
          <DrawerFooter>
            <Button
              className="w-full"
              render={<Link href={reservationHref} onClick={onBeforeNavigate} />}
            >
              {t("viewReservation")}
            </Button>
          </DrawerFooter>
        </DrawerPopup>
      </Drawer>
    </>
  );
}
