"use client";

import type { ReactNode } from "react";

import { ScrollArea } from "@louez/ui";
import { cn } from "@louez/utils";

interface HomeScrollZoneProps {
  /** Names the region for assistive technologies: the card's title. */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * The part of a home card that scrolls. It only does once the cards sit side
 * by side (the page gives them a fixed height then); stacked, nothing bounds
 * its height and the page scrolls as usual. The fade at either edge says
 * there is more. The zone bleeds into the card's padding so the rows keep
 * their hover surface edge to edge.
 */
export const HomeScrollZone = ({ label, children, className }: HomeScrollZoneProps) => (
  <ScrollArea
    aria-label={label}
    orientation="vertical"
    scrollFade
    scrollbarGutter
    className={cn("-mx-2 min-h-0 flex-1 sm:-mx-3", className)}
    viewportClassName="overscroll-auto px-2 sm:px-3"
  >
    {children}
  </ScrollArea>
);
