"use client";

import type { ReactNode } from "react";

import { Check, Clock } from "lucide-react";

import { cn } from "@louez/utils";

import { ReeentMark } from "@/components/shared/reeent-mark";

interface ReeentBannerShellProps {
  /** A dot on the logo: `published` (green check) or `waiting` (amber clock). */
  badge?: "published" | "waiting";
  /** The sentence: its bold lead reads as the title, the rest as the detail. */
  children: ReactNode;
  /** One action, and the close button for an offer. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The one-line banner reeent speaks through on the home: its logo with a
 * state dot, a single sentence, an action. A soft halo grows from the logo;
 * amber while Stripe checks, reeent's orange otherwise. On a narrow screen the
 * action drops under the sentence. It settles in once, never moves after.
 */
export const ReeentBannerShell = ({
  badge,
  children,
  actions,
  className,
}: ReeentBannerShellProps) => {
  const waiting = badge === "waiting";

  return (
    <div
      className={cn(
        "bg-card animate-in fade-in slide-in-from-top-1 grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 rounded-[14px] p-3 ring-1 duration-300 ring-inset motion-reduce:animate-none sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-x-3.5 sm:py-2.5 sm:ps-3 sm:pe-2.5",
        waiting
          ? "ring-badge-warning-foreground/30 bg-[radial-gradient(130px_80px_at_26px_50%,color-mix(in_oklch,var(--color-badge-warning-foreground)_11%,transparent),transparent_72%)]"
          : "ring-reeent/25 bg-[radial-gradient(130px_80px_at_26px_50%,color-mix(in_oklch,var(--color-reeent)_13%,transparent),transparent_72%)]",
        className,
      )}
    >
      <span className="relative mt-px size-8 shrink-0 drop-shadow-[0_4px_8px_color-mix(in_oklch,var(--color-reeent)_22%,transparent)] sm:mt-0">
        <ReeentMark className="size-8" />
        {badge && (
          <span
            aria-hidden
            className={cn(
              "ring-card text-card absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full shadow-sm ring-2",
              waiting ? "bg-badge-warning-foreground" : "bg-success",
            )}
          >
            {waiting ? (
              <Clock className="size-2.5" strokeWidth={2.75} />
            ) : (
              <Check className="size-2.5" strokeWidth={3.25} />
            )}
          </span>
        )}
      </span>
      <p className="text-muted-foreground min-w-0 text-sm leading-normal text-pretty">{children}</p>
      {actions && (
        <div className="col-start-2 flex shrink-0 items-center gap-1.5 sm:col-start-auto">
          {actions}
        </div>
      )}
    </div>
  );
};
