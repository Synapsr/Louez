"use client";

import Link from "next/link";

import { ExternalLink, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { DropdownMenuItem, DropdownMenuSeparator } from "@louez/ui";

import { NEEDS_A_LOOK_PAGE, type NeedsALookBellRow } from "./util.dashboard-notifications";

interface DashboardNotificationsNeedsALookProps {
  /** The most recent items to check, as `needsALookInBell` gives them. */
  rows: NeedsALookBellRow[];
}

/** The bell's section of what needs a look: its rows, then the page for all, details and "Mark as handled". */
export const DashboardNotificationsNeedsALook = ({
  rows,
}: DashboardNotificationsNeedsALookProps) => {
  const t = useTranslations("dashboard.needsALook");

  return (
    <>
      <DropdownMenuSeparator />
      <div className="px-2 py-1">
        <div className="text-muted-foreground px-1 py-1 text-xs font-medium">{t("title")}</div>
        {rows.map((row) => (
          <DropdownMenuItem
            key={row.id}
            render={<Link href={row.href} className="cursor-pointer" />}
            className="items-start gap-3 py-2"
          >
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-300">
              <TriangleAlert className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {t(row.title.key, row.title.values)}
              </span>
              {row.line.length > 0 && (
                <span className="text-muted-foreground line-clamp-2 block text-xs break-words">
                  {row.line.join(" · ")}
                </span>
              )}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem render={<Link href={NEEDS_A_LOOK_PAGE} className="cursor-pointer" />}>
          <ExternalLink className="h-4 w-4" />
          {t("viewAll")}
        </DropdownMenuItem>
      </div>
    </>
  );
};
