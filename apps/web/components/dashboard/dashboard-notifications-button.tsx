"use client";

import { useId } from "react";

import Link from "next/link";

import { Bell, Clock, FileText } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@louez/ui";
import { NotificationsGlassIcon } from "@louez/ui/icons/glass";
import { cn } from "@louez/utils";

import { DASHBOARD_ACCENT_SURFACE } from "@/components/dashboard/shared/dashboard-accent";
import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { getCustomerNameInitials } from "@/components/dashboard/util.customer-initials";
import { useReservationPolling } from "@/contexts/reservation-polling-context";

const ROW_CLASS_NAME = "cursor-pointer items-center gap-3 rounded-lg px-2 py-2";

export const DashboardNotificationsButton = () => {
  const { pendingCount, pendingReservations, pendingSupplierInvoices } = useReservationPolling();
  const t = useTranslations("dashboard.notificationsCenter");
  const format = useFormatter();
  // Re-renders every minute so "il y a 2 min" stays true while the menu is open.
  const now = useNow({ updateInterval: 60_000 });
  const illustrationId = useId();
  const notificationCount = pendingCount + pendingSupplierInvoices;
  const hasReservations = pendingReservations.length > 0;
  const hasSupplierInvoices = pendingSupplierInvoices > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            className="in-[.theme-lagon]:bg-muted in-[.theme-lagon]:hover:bg-accent relative in-[.theme-lagon]:shadow-none in-[.theme-lagon]:hover:shadow-none"
            aria-label={t("title")}
          />
        }
      >
        <Bell className="h-4 w-4" />
        {notificationCount > 0 && (
          <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold">
            {notificationCount > 9 ? "9+" : notificationCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-1.5">
        <p className="px-2 pt-1.5 pb-2 font-semibold tracking-tight">{t("title")}</p>

        {notificationCount === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 pt-2 pb-6 text-center">
            <NotificationsGlassIcon
              uniqueId={`${illustrationId}-empty`}
              size={56}
              className="animate-enter"
            />
            <div className="flex flex-col items-center gap-1">
              <p className="font-bold tracking-tight text-balance">{t("emptyTitle")}</p>
              <p className="text-muted-foreground text-sm text-balance">
                {t("emptyDescription")}
              </p>
            </div>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {hasReservations && (
              <DropdownMenuGroup>
                <DropdownMenuLabel className="flex items-center gap-2">
                  {t("pendingReservations")}
                  <Badge variant="pending" size="sm">
                    {pendingCount}
                  </Badge>
                </DropdownMenuLabel>
                {pendingReservations.map((reservation) => (
                  <DropdownMenuItem
                    key={reservation.id}
                    render={<Link href={`/dashboard/reservations/${reservation.id}`} />}
                    className={ROW_CLASS_NAME}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "relative flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        DASHBOARD_ACCENT_SURFACE.pending,
                      )}
                    >
                      {getCustomerNameInitials(reservation.customerName)}
                      <span className="bg-badge-pending-foreground ring-popover absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2" />
                    </span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="flex min-w-0 items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold">
                          {reservation.customerName}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {format.relativeTime(new Date(reservation.createdAt), now)}
                        </span>
                      </span>
                      <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                        <span className="text-foreground/70 shrink-0 font-medium tabular-nums">
                          #{reservation.number}
                        </span>
                        <span aria-hidden="true">·</span>
                        <Clock className="size-3 shrink-0" />
                        <span className="truncate">
                          {format.dateTime(new Date(reservation.startDate), {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            )}

            {hasSupplierInvoices && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("supplierInvoices")}</DropdownMenuLabel>
                <DropdownMenuItem
                  render={<Link href="/dashboard/purchase-invoices" />}
                  className={ROW_CLASS_NAME}
                >
                  <DashboardIconTile icon={FileText} accent="submitted" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {t("pendingSupplierInvoices", { count: pendingSupplierInvoices })}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            )}
          </div>
        )}

        {pendingCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={<Link href="/dashboard/reservations?status=pending" />}
              className="text-primary cursor-pointer justify-center font-medium"
            >
              {t("viewAllPending")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
