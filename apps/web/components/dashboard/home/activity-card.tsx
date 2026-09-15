"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { ActivityCardView, type ActivityCardViewProps } from "./activity-card-view";
import { ReservationCalendarPrefetchBoundary } from "./reservation-calendar-prefetch-boundary";

type ActivityCardProps = Omit<
  ActivityCardViewProps,
  "action" | "onViewAll" | "onSelectReservation"
> & {
  prefetchCalendar?: boolean;
};

export const ActivityCard = ({ prefetchCalendar = false, ...props }: ActivityCardProps) => {
  const t = useTranslations("dashboard.home");
  return (
    <ActivityCardView
      {...props}
      action={
        prefetchCalendar ? (
          <ReservationCalendarPrefetchBoundary href={props.viewAllHref}>
            <Button variant="ghost" size="sm" render={<Link href={props.viewAllHref} />}>
              <span className="max-sm:sr-only">{t("viewAll")}</span>
              <ArrowRight />
            </Button>
          </ReservationCalendarPrefetchBoundary>
        ) : undefined
      }
    />
  );
};
