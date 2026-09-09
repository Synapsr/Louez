import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import {
  isClosedReservationStatus,
  type ReservationStatus,
} from "@/components/storefront/account/reservation-status.constants";

interface ReservationTimelineProps {
  status: ReservationStatus;
  /** Formatted in the store timezone. */
  createdLabel: string;
  pickedUpLabel: string | null;
  returnedLabel: string | null;
}

type StepKey = "requested" | "quoteSent" | "confirmed" | "pickedUp" | "returned" | "closed";

interface Step {
  key: StepKey;
  state: "done" | "current" | "todo" | "closed";
  date: string | null;
}

const RANK: Record<ReservationStatus, number> = {
  pending: 0,
  quote: 1,
  confirmed: 2,
  ongoing: 3,
  completed: 4,
  cancelled: 0,
  rejected: 0,
  declined: 1,
};

const buildSteps = ({
  status,
  createdLabel,
  pickedUpLabel,
  returnedLabel,
}: ReservationTimelineProps): Step[] => {
  const rank = RANK[status];
  const closed = isClosedReservationStatus(status);
  const withQuote = status === "quote" || status === "declined";

  const flow: Array<{ key: StepKey; rank: number; date: string | null }> = [
    { key: "requested", rank: 0, date: createdLabel },
    ...(withQuote ? [{ key: "quoteSent" as const, rank: 1, date: null }] : []),
    { key: "confirmed", rank: 2, date: null },
    { key: "pickedUp", rank: 3, date: pickedUpLabel },
    { key: "returned", rank: 4, date: returnedLabel },
  ];

  const steps: Step[] = flow.map((step) => ({
    key: step.key,
    date: step.date,
    state: closed
      ? step.rank <= rank
        ? "done"
        : "closed"
      : step.rank < rank
        ? "done"
        : step.rank === rank
          ? "current"
          : "todo",
  }));

  // A closed reservation stops after its last reached step, with a final
  // "closed" node in the status word.
  return closed
    ? [
        ...steps.filter((step) => step.state === "done"),
        { key: "closed", state: "closed", date: null },
      ]
    : steps;
};

/** Vertical progress: request → confirmed → picked up → returned. */
export const ReservationTimeline = (props: ReservationTimelineProps) => {
  const t = useTranslations("storefront.account");
  const steps = buildSteps(props);

  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const label =
          step.key === "closed" ? t(`status.${props.status}`) : t(`timeline.${step.key}`);

        return (
          <li key={step.key} className="flex gap-3">
            <div className="relative flex shrink-0 flex-col items-center">
              <span
                aria-hidden
                className={cn(
                  "relative z-10 mt-1 size-3 shrink-0 rounded-full border-2",
                  step.state === "done" && "border-success bg-success",
                  step.state === "current" && "border-primary bg-primary ring-4 ring-primary/20",
                  step.state === "todo" && "border-border bg-background",
                  step.state === "closed" && "border-muted-foreground/40 bg-muted",
                )}
              />
              {!isLast ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute -bottom-1 left-1/2 top-4 w-px -translate-x-1/2",
                    step.state === "done" ? "bg-success" : "bg-border",
                  )}
                />
              ) : null}
            </div>
            <div className={cn("flex flex-col pb-4", isLast && "pb-0")}>
              <span
                className={cn(
                  "text-sm leading-5",
                  step.state === "current"
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                  step.state === "done" && "text-foreground",
                )}
              >
                {label}
              </span>
              {step.date ? (
                <span className="text-xs text-muted-foreground">{step.date}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
};
