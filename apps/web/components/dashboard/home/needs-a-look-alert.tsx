"use client";

import Link from "next/link";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { TriangleAlertIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";

interface NeedsALookAlertProps {
  /** Items that need a look, up to NEEDS_A_LOOK_COUNT_MAX. */
  count: number;
  /** More than that wait: the line reads "99+". */
  capped: boolean;
  className?: string;
}

/** The home's line to the page of what needs a look, as the pending-bookings alert reads. */
export const NeedsALookAlert = ({ count, capped, className }: NeedsALookAlertProps) => {
  const t = useTranslations("dashboard.needsALook.alert");

  if (count === 0) {
    return null;
  }

  return (
    <Link
      href="/dashboard/inbox"
      className={cn(
        "group bg-badge-pending-background/60 ring-badge-pending-foreground/15 hover:bg-badge-pending-background focus-visible:ring-ring flex flex-col gap-3 rounded-2xl p-4 ring-1 transition-colors ring-inset focus-visible:ring-2 focus-visible:outline-none sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <DashboardIconTile icon={TriangleAlertIcon} accent="pending" className="bg-background/70" />
        <div className="min-w-0">
          <p className="font-medium">{capped ? t("titleCapped") : t("title", { count })}</p>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
      </div>
      <span className="text-badge-pending-foreground flex shrink-0 items-center gap-1.5 text-sm font-medium max-sm:justify-end">
        {t("action")}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
      </span>
    </Link>
  );
};
