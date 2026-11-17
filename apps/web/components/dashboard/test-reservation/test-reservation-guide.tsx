"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { ChevronDown, FlaskConical } from "lucide-react";

import type { ReservationStatus } from "@louez/api/contracts/reservations";
import type { GetTestReservationOutput } from "@louez/api/contracts/test-reservations";
import { Button, Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@louez/ui";
import { cn } from "@louez/utils";

import { reservationsQueries } from "@/lib/queries/reservations.queries";
import { testReservationQueries } from "@/lib/queries/test-reservations.queries";

import { DeleteTestReservationButton } from "./delete-test-reservation-button";
import { TestGuideStepItem } from "./test-guide-step-item";
import { TestReservationFinish } from "./test-reservation-finish";
import { testGuideState } from "./util.test-guide-steps";

interface TestReservationGuideProps {
  reservationId: string;
  /** The reservation's status when the page was read; the page's own query follows it. */
  initialStatus: ReservationStatus;
  /** Read by the page on the server. */
  initialState: GetTestReservationOutput;
  className?: string;
}

/**
 * The guide on a test reservation's page: three steps, each done with the
 * page's own buttons, how to do the current one behind a disclosure, then
 * the finish (share the store, delete the test). Nothing for any other
 * reservation.
 */
export const TestReservationGuide = ({
  reservationId,
  initialStatus,
  initialState,
  className,
}: TestReservationGuideProps) => {
  const t = useTranslations("dashboard.testReservation");
  const tReservations = useTranslations("dashboard.reservations");
  const format = useFormatter();
  const { data: state } = useQuery({
    ...testReservationQueries.get(),
    initialData: initialState,
    // An inspection made on its own page: read again on the way back.
    staleTime: 0,
  });
  // The page's reservation, as the actions above change it; never fetched here.
  const { data: reservation } = useQuery({
    ...reservationsQueries.detail(reservationId),
    enabled: false,
  });

  const testReservation = state.reservation;
  if (!testReservation || testReservation.id !== reservationId) return null;

  const guide = testGuideState({
    status: reservation?.status ?? initialStatus,
    inspectionsEnabled: state.inspectionsEnabled,
    hasDepartureInspection: state.hasDepartureInspection,
  });

  const buttonLabels = {
    confirm: tReservations("acceptRequest"),
    pickup: tReservations("actions.markPickedUp"),
    return: tReservations("actions.markReturned"),
  };

  return (
    <section
      className={cn("bg-card ring-border space-y-4 rounded-2xl p-4 ring-1 ring-inset", className)}
    >
      {guide.kind === "done" ? (
        <TestReservationFinish
          reservationId={reservationId}
          storefrontUrl={state.storefrontUrl}
          hasMarketplaceChannel={state.hasMarketplaceChannel}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                <FlaskConical className="size-4" />
              </span>
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{t("guide.title")}</p>
                <p className="text-muted-foreground text-sm">
                  {t(guide.kind === "closed" ? "guide.closed" : "guide.description")}
                </p>
              </div>
            </div>
            <DeleteTestReservationButton reservationId={reservationId} />
          </div>

          {guide.kind === "steps" && (
            <>
              <ol className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                {guide.steps.map((step, index) => (
                  <TestGuideStepItem
                    key={step.key}
                    index={index + 1}
                    label={t(`guide.steps.${step.key}.title`)}
                    done={step.done}
                    current={step.key === guide.current}
                  />
                ))}
              </ol>

              {guide.current === "departureInspection" && (
                <Button
                  size="sm"
                  render={
                    <Link href={`/dashboard/reservations/${reservationId}/inspection/departure`} />
                  }
                >
                  {t("guide.steps.departureInspection.action")}
                </Button>
              )}

              <Collapsible>
                <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-sm">
                  {t("guide.howTo")}
                  <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <div className="text-muted-foreground space-y-1 pt-2 text-sm">
                    <p>
                      {guide.current === "departureInspection"
                        ? t("guide.steps.departureInspection.help")
                        : t(`guide.steps.${guide.current}.help`, {
                            button: buttonLabels[guide.current],
                          })}
                    </p>
                    <p>
                      {t("guide.expires", {
                        date: format.dateTime(testReservation.expiresAt, { dateStyle: "long" }),
                      })}
                    </p>
                  </div>
                </CollapsiblePanel>
              </Collapsible>
            </>
          )}
        </>
      )}
    </section>
  );
};
