"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { FlaskConical } from "lucide-react";

import type { GetTestReservationOutput } from "@louez/api/contracts/test-reservations";
import { cn } from "@louez/utils";

import { testReservationQueries } from "@/lib/queries/test-reservations.queries";

import { StartTestReservationButton } from "./start-test-reservation-button";

interface TestReservationHomeCardProps {
  /** Read by the page on the server. */
  initialState: GetTestReservationOutput;
  className?: string;
}

/**
 * The home's first step once the store has a product and no real
 * reservation yet: book as a customer would, then manage it here.
 */
export const TestReservationHomeCard = ({
  initialState,
  className,
}: TestReservationHomeCardProps) => {
  const t = useTranslations("dashboard.testReservation.homeCard");
  // Seeds the button's own read of the same query.
  useQuery({ ...testReservationQueries.get(), initialData: initialState });

  return (
    <div
      className={cn(
        "bg-card ring-border flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-inset sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
          <FlaskConical className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{t("title")}</p>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
      </div>
      <StartTestReservationButton className="shrink-0 max-sm:self-end" />
    </div>
  );
};
