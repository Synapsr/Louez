import type { ReactNode } from "react";

import { cn } from "@louez/utils";

type OutcomeTone = "success" | "pending" | "info" | "destructive";

interface OutcomeHeaderProps {
  tone: OutcomeTone;
  /** A lucide icon; sized by the circle. */
  icon: ReactNode;
  title: ReactNode;
  /** One line: what happened and what comes next. */
  description?: ReactNode;
  /** Actions, at most two; the primary one first. */
  children?: ReactNode;
  className?: string;
}

const TONE_CLASS_NAMES: Record<OutcomeTone, string> = {
  success: "bg-success/12 text-success",
  pending: "bg-reservation-pending-soft text-reservation-pending-text",
  info: "bg-info/12 text-info",
  destructive: "bg-destructive/12 text-destructive",
};

/**
 * Header of a result page (paid, request sent, payment cancelled, link
 * expired): tone circle, title, one line, actions. Same shape everywhere so
 * the five former landing pages read as one.
 */
export const OutcomeHeader = ({
  tone,
  icon,
  title,
  description,
  children,
  className,
}: OutcomeHeaderProps) => (
  <header
    className={cn("flex flex-col items-center gap-3 text-center", className)}
    data-slot="outcome-header"
  >
    <div
      aria-hidden
      className={cn(
        "flex size-14 items-center justify-center rounded-full [&_svg]:size-7",
        TONE_CLASS_NAMES[tone],
      )}
    >
      {icon}
    </div>
    <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
      {title}
    </h1>
    {description ? (
      <p className="max-w-prose text-pretty text-sm text-muted-foreground sm:text-base">
        {description}
      </p>
    ) : null}
    {children ? (
      <div className="mt-2 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">
        {children}
      </div>
    ) : null}
  </header>
);
