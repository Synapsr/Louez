"use client";

import { useEffect } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Clock, ExternalLink, FileText } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@louez/ui";

import { useReservationPolling } from "@/contexts/reservation-polling-context";
import { useStore } from "@/contexts/store-context";
import { useNeedsALookFormat } from "@/hooks/use-needs-a-look-format";
import { needsALookQueries } from "@/lib/queries/needs-a-look.queries";

import { DashboardNotificationsNeedsALook } from "./dashboard-notifications-needs-a-look";
import { needsALookInBell, notificationsBadge } from "./util.dashboard-notifications";

export const DashboardNotificationsButton = () => {
  const { pendingCount, pendingReservations, pendingSupplierInvoices } = useReservationPolling();
  const t = useTranslations("dashboard.notificationsCenter");
  const format = useFormatter();
  // What needs a look: read after paint, outside the 30-second poll, for this store only.
  const { storeId } = useStore();
  const queryClient = useQueryClient();
  const needsALookQuery = useQuery(needsALookQueries.summary(storeId));
  // Other screens settle items without telling the bell: each page reads them again.
  const pathname = usePathname();
  useEffect(() => {
    void needsALookQueries.readAgain(queryClient, storeId);
  }, [pathname, queryClient, storeId]);
  const toCheck = needsALookInBell(needsALookQuery, useNeedsALookFormat());
  const badge = notificationsBadge({
    polled: pendingCount + pendingSupplierInvoices,
    toCheck: toCheck?.count ?? 0,
  });
  // "Nothing to handle" is said once, and only when no section has anything.
  const nothingElse = pendingReservations.length === 0 && pendingSupplierInvoices === 0 && !toCheck;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void needsALookQueries.readAgain(queryClient, storeId, { always: true });
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="icon" className="relative" aria-label={t("title")} />
        }
      >
        <Bell className="h-4 w-4" />
        {badge && (
          <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold">
            {badge}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="px-3 py-2">
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="text-muted-foreground text-xs">{t("description")}</p>
        </div>
        {nothingElse && (
          <>
            <DropdownMenuSeparator />
            <div className="px-3 py-5 text-center">
              <p className="text-sm font-medium">{t("emptyTitle")}</p>
              <p className="text-muted-foreground mt-1 text-xs">{t("emptyDescription")}</p>
            </div>
          </>
        )}
        {pendingReservations.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1">
              <div className="text-muted-foreground px-1 py-1 text-xs font-medium">
                {t("pendingReservations")}
              </div>
              {pendingReservations.map((reservation) => (
                <DropdownMenuItem
                  key={reservation.id}
                  render={
                    <Link
                      href={`/dashboard/reservations/${reservation.id}`}
                      className="cursor-pointer"
                    />
                  }
                  className="items-start gap-3 py-2"
                >
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-300">
                    <Clock className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      #{reservation.number}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {reservation.customerName}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {format.dateTime(new Date(reservation.startDate), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          </>
        )}
        {pendingSupplierInvoices > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1">
              <div className="text-muted-foreground px-1 py-1 text-xs font-medium">
                {t("supplierInvoices")}
              </div>
              <DropdownMenuItem
                render={<Link href="/dashboard/purchase-invoices" className="cursor-pointer" />}
                className="items-start gap-3 py-2"
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-300">
                  <FileText className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {t("pendingSupplierInvoices", { count: pendingSupplierInvoices })}
                </span>
              </DropdownMenuItem>
            </div>
          </>
        )}
        {toCheck && <DashboardNotificationsNeedsALook rows={toCheck.rows} />}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<Link href="/dashboard/reservations?status=pending" className="cursor-pointer" />}
        >
          <ExternalLink className="h-4 w-4" />
          {t("viewAllPending")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
