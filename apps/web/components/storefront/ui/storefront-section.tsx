import type { ReactNode } from "react";

import { cn } from "@louez/utils";

type StorefrontSectionTone = "default" | "muted";
type StorefrontSectionSpacing = "default" | "tight" | "none";
type StorefrontSectionWidth = "default" | "narrow";

interface StorefrontSectionProps {
  id?: string;
  /** `muted` for the one alternate band a page may have (contact, reviews). */
  tone?: StorefrontSectionTone;
  /** Vertical rhythm; `none` when the parent already stacks with `gap-*`. */
  spacing?: StorefrontSectionSpacing;
  /** `narrow` for forms, login and legal text (measure of ~65 characters). */
  width?: StorefrontSectionWidth;
  "aria-labelledby"?: string;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}

const SPACING_CLASS_NAMES: Record<StorefrontSectionSpacing, string> = {
  default: "py-4 sm:py-12",
  tight: "py-4 sm:py-6",
  none: "py-0",
};

const WIDTH_CLASS_NAMES: Record<StorefrontSectionWidth, string> = {
  default: "max-w-7xl",
  narrow: "max-w-2xl",
};

/**
 * The page band every storefront section sits in: one horizontal gutter
 * (`px-4 sm:px-6 lg:px-8`), one content width, two vertical rhythms.
 * Pages compose these back to back; nothing else defines page padding.
 */
export const StorefrontSection = ({
  id,
  tone = "default",
  spacing = "default",
  width = "default",
  "aria-labelledby": ariaLabelledBy,
  className,
  contentClassName,
  children,
}: StorefrontSectionProps) => (
  <section
    id={id}
    aria-labelledby={ariaLabelledBy}
    className={cn(tone === "muted" && "bg-muted", SPACING_CLASS_NAMES[spacing], className)}
    data-slot="storefront-section"
  >
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        WIDTH_CLASS_NAMES[width],
        contentClassName,
      )}
    >
      {children}
    </div>
  </section>
);
