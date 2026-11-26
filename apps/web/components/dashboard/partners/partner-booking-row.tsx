"use client";

import Link from "next/link";

import { MoreHorizontal, Pencil, Unlink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { PartnerBooking } from "@louez/api/contracts/partners";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@louez/ui";
import { cn, formatCurrency } from "@louez/utils";

const STATE_BADGE = {
  upcoming: "pending",
  due: "success",
  cancelled: "tertiary",
} as const satisfies Record<PartnerBooking["state"], string>;

interface PartnerBookingRowProps {
  booking: PartnerBooking;
  currency: string;
  /** The member may change partners (`manage_settings`); else its actions are disabled. */
  canManage: boolean;
  onAdjust: () => void;
  onRemove: () => void;
}

/** One attributed reservation of a statement: its dates, commission and state. */
export const PartnerBookingRow = ({
  booking,
  currency,
  canManage,
  onAdjust,
  onRemove,
}: PartnerBookingRowProps) => {
  const t = useTranslations("dashboard.partners.statement");
  const format = useFormatter();
  const cancelled = booking.state === "cancelled";

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <Link
          href={`/dashboard/reservations/${booking.reservationId}`}
          className="font-medium hover:underline"
        >
          #{booking.number}
        </Link>
        <p className="text-muted-foreground text-sm">
          {format.dateTimeRange(booking.startDate, booking.endDate, {
            day: "numeric",
            month: "short",
          })}
          {" · "}
          {formatCurrency(booking.base, currency)}
          {booking.origin === "manual" && ` · ${t("manual")}`}
          {booking.origin === "code" && ` · ${t("byCode")}`}
        </p>
        {booking.adjustment && (
          <p className="text-muted-foreground text-xs">
            {t("adjusted", { amount: formatCurrency(booking.computed, currency) })}
            {booking.adjustment.note && ` — ${booking.adjustment.note}`}
          </p>
        )}
      </div>
      <div className="shrink-0 space-y-1 text-right">
        <p
          className={cn(
            "font-medium tabular-nums",
            cancelled && "text-muted-foreground line-through",
          )}
        >
          {formatCurrency(booking.commission, currency)}
        </p>
        <Badge variant={STATE_BADGE[booking.state]}>{t(`states.${booking.state}`)}</Badge>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" className="size-8" aria-label={t("actions")} />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onAdjust} disabled={!canManage}>
            <Pencil className="size-4" />
            {t("adjust")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRemove} disabled={!canManage}>
            <Unlink className="size-4" />
            {t("remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
};
