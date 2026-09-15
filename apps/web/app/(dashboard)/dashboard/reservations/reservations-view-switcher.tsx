"use client";

import { CalendarDays, LayoutList, List } from "lucide-react";
import { useTranslations } from "next-intl";

import { Tabs, TabsList, TabsTab } from "@louez/ui";

import type { ReservationView } from "./calendar/calendar-query";

const VIEW_OPTIONS = [
  { value: "list", icon: List },
  { value: "calendar", icon: CalendarDays },
  { value: "planning", icon: LayoutList },
] as const;

interface ReservationsViewSwitcherProps {
  view: ReservationView;
  onViewChange: (view: ReservationView) => void;
  className?: string;
  views?: readonly ReservationView[];
}

/**
 * Segmented control to switch between the list, calendar and planning views
 * of the reservations page. The view is reflected in the URL and remembered
 * per store for future visits without an explicit view.
 *
 * Segmented (`Tabs` default variant) reads as "same data, another layout",
 * as opposed to the underlined status filter below it, which narrows the data.
 */
export function ReservationsViewSwitcher({
  view,
  onViewChange,
  className,
  views,
}: ReservationsViewSwitcherProps) {
  const t = useTranslations("dashboard.reservations.views");

  const handleChange = (value: ReservationView) => {
    if (value === view) return;
    onViewChange(value);
  };

  return (
    <Tabs value={view} onValueChange={(value) => handleChange(value as ReservationView)}>
      <TabsList className={className} aria-label={t("label")}>
        {VIEW_OPTIONS.filter(({ value }) => !views || views.includes(value)).map(
          ({ value, icon: Icon }) => (
            <TabsTab key={value} value={value} aria-label={t(value)} data-reservations-view={value}>
              <Icon />
              <span className="hidden sm:inline">{t(value)}</span>
            </TabsTab>
          ),
        )}
      </TabsList>
    </Tabs>
  );
}
