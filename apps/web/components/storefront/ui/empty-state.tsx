import type { ReactNode } from "react";

import { cn } from "@louez/utils";

type EmptyStateTone = "plain" | "card";

interface EmptyStateProps {
  /** A lucide icon; sized by the circle. */
  icon?: ReactNode;
  title: ReactNode;
  /** One line. */
  description?: ReactNode;
  /** The one action that gets the visitor out of the dead end. */
  action?: ReactNode;
  /** `card` draws a dashed surface for an empty list inside a page. */
  tone?: EmptyStateTone;
  className?: string;
}

/**
 * Empty catalogue, empty cart, no reservations: icon, title, one line and
 * one way forward. Never an empty state without an action.
 */
export const EmptyState = ({
  icon,
  title,
  description,
  action,
  tone = "plain",
  className,
}: EmptyStateProps) => (
  <div
    className={cn(
      "flex flex-col items-center gap-2 px-6 py-12 text-center",
      tone === "card" && "rounded-2xl border border-dashed bg-muted/40",
      className,
    )}
    data-slot="empty-state"
  >
    {icon ? (
      <div
        aria-hidden
        className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6"
      >
        {icon}
      </div>
    ) : null}
    <h3 className="text-base font-semibold">{title}</h3>
    {description ? (
      <p className="max-w-sm text-pretty text-sm text-muted-foreground">{description}</p>
    ) : null}
    {action ? <div className="mt-3">{action}</div> : null}
  </div>
);
