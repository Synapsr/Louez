"use client";

import { useTranslations } from "next-intl";

import type { TimeOfDay } from "@/lib/dashboard/util.store-day";

interface HomeHeaderProps {
  firstName: string;
  timeOfDay: TimeOfDay;
}

/**
 * The home's greeting, and only that: what needs the owner is in the cards
 * below, so a sentence repeating it here added nothing.
 */
export const HomeHeader = ({ firstName, timeOfDay }: HomeHeaderProps) => {
  const t = useTranslations("dashboard.home");

  return (
    <h1 className="min-w-0 text-xl font-extrabold tracking-tight text-balance sm:text-2xl">
      {firstName
        ? t(`header.greeting.${timeOfDay}`, { name: firstName })
        : t(`header.greeting.${timeOfDay}Anonymous`)}
    </h1>
  );
};
