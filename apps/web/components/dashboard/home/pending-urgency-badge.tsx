"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";

import type { PendingUrgency } from "@/lib/dashboard/util.pending-urgency";

const VARIANT = {
  past: "tertiary",
  today: "failed",
  tomorrow: "failed",
  soon: "warning",
} as const;

/** How close a request's start is, shown only when there is a real deadline. */
export const PendingUrgencyBadge = ({ urgency }: { urgency: PendingUrgency | null }) => {
  const t = useTranslations("dashboard.home.pending.urgency");
  if (!urgency) return null;

  return (
    <Badge variant={VARIANT[urgency.kind]} size="sm" className="shrink-0">
      {urgency.kind === "soon" ? t("soon", { count: urgency.days }) : t(urgency.kind)}
    </Badge>
  );
};
