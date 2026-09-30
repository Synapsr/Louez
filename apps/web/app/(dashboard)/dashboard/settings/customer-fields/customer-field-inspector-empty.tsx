"use client";

import { GripVertical, MousePointerClick, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";

/** The docked panel with nothing selected: what to do, and the two gestures worth knowing. */
export const CustomerFieldInspectorEmpty = () => {
  const t = useTranslations("dashboard.settings.customerFields.builder.inspector");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10">
      <DashboardEmptyState
        icon={MousePointerClick}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
        className="py-0"
      />
      <ul className="text-muted-foreground flex flex-col gap-1.5 text-xs">
        <li className="flex items-center gap-2">
          <GripVertical aria-hidden className="size-3.5 shrink-0" />
          {t("tipDrag")}
        </li>
        <li className="flex items-center gap-2">
          <MoreHorizontal aria-hidden className="size-3.5 shrink-0" />
          {t("tipMenu")}
        </li>
      </ul>
    </div>
  );
};
