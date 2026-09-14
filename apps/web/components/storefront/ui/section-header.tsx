import type { ReactNode } from "react";

import { cn } from "@louez/utils";

type SectionHeadingLevel = "h1" | "h2" | "h3";

interface SectionHeaderProps {
  title: ReactNode;
  /** One line at most; explanations belong in a tooltip, not here. */
  description?: ReactNode;
  /** Right-aligned slot: a "Voir tout" link, a count, a sort control. */
  action?: ReactNode;
  /** Heading element and its step on the type scale; `h2` for a page section. */
  level?: SectionHeadingLevel;
  align?: "start" | "center";
  id?: string;
  className?: string;
}

const HEADING_CLASS_NAMES: Record<SectionHeadingLevel, string> = {
  h1: "text-2xl font-semibold leading-tight tracking-tight sm:text-3xl",
  h2: "text-xl font-semibold leading-tight tracking-tight sm:text-2xl",
  h3: "text-lg font-semibold leading-snug",
};

/**
 * Title row of a section: heading on the type scale, optional one-line
 * description, optional action aligned to the end. Bottom margin included
 * so the section body starts at the same distance everywhere.
 */
export const SectionHeader = ({
  title,
  description,
  action,
  level = "h2",
  align = "start",
  id,
  className,
}: SectionHeaderProps) => {
  const Heading = level;

  return (
    <div
      className={cn(
        "mb-4 flex gap-4 sm:mb-6",
        align === "center" ? "flex-col items-center text-center" : "items-end justify-between",
        className,
      )}
      data-slot="section-header"
    >
      <div className="min-w-0">
        <Heading id={id} className={cn("text-balance", HEADING_CLASS_NAMES[level])}>
          {title}
        </Heading>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
};
