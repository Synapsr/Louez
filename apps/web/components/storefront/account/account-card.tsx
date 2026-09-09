import type { ReactNode } from "react";

import { cn } from "@louez/utils";

interface AccountCardProps {
  title?: ReactNode;
  /** Right-aligned slot next to the title (a badge, a count). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** The one surface of the account pages: `rounded-2xl shadow-card`, h3 title. */
export const AccountCard = ({ title, aside, className, children }: AccountCardProps) => (
  <section
    className={cn("flex flex-col gap-4 rounded-2xl bg-card p-4 shadow-card sm:p-6", className)}
  >
    {title ? (
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold leading-snug">{title}</h3>
        {aside ? <div className="ms-auto max-w-full">{aside}</div> : null}
      </header>
    ) : null}
    {children}
  </section>
);
