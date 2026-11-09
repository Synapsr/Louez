"use client";

import { type ComponentType, useId } from "react";

import type { GlassIconProps } from "@louez/ui/icons/glass";
import { cn } from "@louez/utils";

type GlassIcon = ComponentType<GlassIconProps & { uniqueId?: string }>;

interface GlassIllustrationProps {
  /** The subject of the screen, drawn large. */
  main: GlassIcon;
  /** Up to two companions placed around it, smaller. */
  companions?: readonly [] | readonly [GlassIcon] | readonly [GlassIcon, GlassIcon];
  size?: "md" | "lg";
  className?: string;
}

const SIZES = {
  md: { box: "h-36 w-52", main: 104, companion: 40 },
  lg: { box: "h-44 w-64", main: 128, companion: 48 },
} as const;

/**
 * The Lagon illustration: Nucleo Glass icons composed at illustration size,
 * one subject and its companions, over a faint Écume halo.
 *
 * It does not move on its own — the composition settles in once with the page
 * and then stays still: a back-office screen is read for minutes, a looping
 * illustration only competes with the content.
 *
 * Every icon gets its own `uniqueId`: Nucleo Glass references gradients by id,
 * and the same icon already sits in the nav with the muted Ardoise tone — a
 * shared id would hand this one the nav's colours.
 */
export const GlassIllustration = ({
  main: Main,
  companions = [],
  size = "md",
  className,
}: GlassIllustrationProps) => {
  const id = useId();
  const dims = SIZES[size];
  const [First, Second] = companions;

  return (
    <div aria-hidden className={cn("relative shrink-0", dims.box, className)}>
      <div className="from-ecume/30 via-primary/10 absolute inset-[-25%] rounded-full bg-radial to-transparent to-70%" />
      <Main
        uniqueId={`${id}-main`}
        size={dims.main}
        className="animate-enter absolute top-1 left-1/2 -translate-x-1/2"
      />
      {First && (
        <First
          uniqueId={`${id}-first`}
          size={dims.companion}
          className="animate-enter absolute bottom-1 left-0 [animation-delay:80ms]"
        />
      )}
      {Second && (
        <Second
          uniqueId={`${id}-second`}
          size={dims.companion}
          className="animate-enter absolute top-0 right-0 [animation-delay:120ms]"
        />
      )}
    </div>
  );
};
