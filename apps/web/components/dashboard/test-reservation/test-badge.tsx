"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";

import { testReservationQueries } from "@/lib/queries/test-reservations.queries";

interface TestBadgeProps {
  reservationId: string;
  className?: string;
}

/**
 * "Test" next to a reservation's status, when it is the store's test
 * reservation (one per store): every list reads the same cached answer.
 */
export const TestBadge = ({ reservationId, className }: TestBadgeProps) => {
  const t = useTranslations("dashboard.testReservation");
  const { data } = useQuery(testReservationQueries.get());
  if (data?.reservation?.id !== reservationId) return null;
  return (
    <Badge variant="warning" className={className}>
      {t("badge")}
    </Badge>
  );
};
