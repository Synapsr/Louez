"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { FlaskConical, X } from "lucide-react";

import type { GetTestReservationOutput } from "@louez/api/contracts/test-reservations";
import { Button, toastManager } from "@louez/ui";
import { cn } from "@louez/utils";

import { TEST_RESERVATION_NOTICE_ID } from "@/components/dashboard/home/util.next-step";
import { apiErrorKey } from "@/lib/orpc/errors";
import { accountMutations } from "@/lib/queries/account.queries";
import { testReservationQueries } from "@/lib/queries/test-reservations.queries";

import { StartTestReservationButton } from "./start-test-reservation-button";

interface TestReservationHomeCardProps {
  /** Read by the page on the server. */
  initialState: GetTestReservationOutput;
  className?: string;
}

/**
 * The home's first step once the store has a product and no real
 * reservation yet: book as a customer would, then manage it here. Closed for
 * good by the user, who still finds the test in the "Mise en route" checklist.
 */
export const TestReservationHomeCard = ({
  initialState,
  className,
}: TestReservationHomeCardProps) => {
  const t = useTranslations("dashboard.testReservation.homeCard");
  const tErrors = useTranslations("errors");
  // Seeds the button's own read of the same query.
  useQuery({ ...testReservationQueries.get(), initialData: initialState });
  // The card stays until the close is saved: a failed save keeps it and says so.
  const dismissal = useMutation({
    ...accountMutations.dismissNotice(),
    onError: (error) => {
      const key = apiErrorKey(error);
      toastManager.add({
        title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
        type: "error",
      });
    },
  });

  if (dismissal.isSuccess) return null;

  return (
    <div
      className={cn(
        "bg-card ring-border relative flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-inset sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3 pr-8 sm:pr-0">
        <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
          <FlaskConical className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{t("title")}</p>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 max-sm:self-end">
        <StartTestReservationButton />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("dismiss")}
          title={t("dismiss")}
          disabled={dismissal.isPending}
          onClick={() => dismissal.mutate({ noticeId: TEST_RESERVATION_NOTICE_ID })}
          className="text-muted-foreground max-sm:absolute max-sm:top-3 max-sm:right-3"
        >
          <X />
        </Button>
      </div>
    </div>
  );
};
