"use client";

import { useTranslations } from "next-intl";

import type { Lateness } from "@/lib/dashboard/util.lateness";

/** "20 min", "5 h", "6 j": a lateness in a few characters, in the owner's language. */
export const useLatenessText = () => {
  const t = useTranslations("dashboard.home.overdue");
  return ({ unit, value }: Lateness) =>
    t(unit === "minutes" ? "lateMinutes" : unit === "hours" ? "lateHours" : "lateDays", {
      count: value,
    });
};
