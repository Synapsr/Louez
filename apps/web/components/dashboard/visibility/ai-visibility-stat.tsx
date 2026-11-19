"use client";

import { useTranslations } from "next-intl";

/** One figure of the AI section, over the guide's 28-day window. */
export const AiVisibilityStat = ({ value, label }: { value: number; label: string }) => {
  const t = useTranslations("dashboard.visibility.ai");
  return (
    <div className="bg-muted/50 rounded-xl p-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground text-sm leading-snug">{label}</p>
      <p className="text-muted-foreground text-xs">{t("stats.period")}</p>
    </div>
  );
};
