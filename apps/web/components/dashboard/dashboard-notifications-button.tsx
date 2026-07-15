"use client";

import Link from "next/link";

import { Bell, Clock, ExternalLink } from "lucide-react";
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

export const DashboardNotificationsButton = () => {
  const { pendingCount, pendingReservations } = useReservationPolling();
  const t = useTranslations("dashboard.notificationsCenter");
  const format = useFormatter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="icon" className="relative" aria-label={t("title")} />
        }
      >
        <Bell className="h-4 w-4" />
        {pendingCount > 0 && (
          <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold">
            {pendingCount > 9 ? "9+" : pendingCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="px-3 py-2">
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="text-muted-foreground text-xs">{t("description")}</p>
        </div>
        <DropdownMenuSeparator />
        <div className="px-2 py-1">
          <div className="text-muted-foreground px-1 py-1 text-xs font-medium">
            {t("pendingReservations")}
          </div>
          {pendingReservations.length === 0 ? (
            <div className="px-1 py-5 text-center">
              <p className="text-sm font-medium">{t("emptyTitle")}</p>
              <p className="text-muted-foreground mt-1 text-xs">{t("emptyDescription")}</p>
            </div>
          ) : (
            pendingReservations.map((reservation) => (
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
                  <span className="block truncate text-sm font-medium">#{reservation.number}</span>
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
            ))
          )}
        </div>
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
