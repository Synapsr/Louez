"use client";

import { Button } from "@louez/ui";
import { BagPlusIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

interface QuickAddButtonProps {
  /** Visible label, and the accessible name. */
  label: string;
  onClick: () => void;
  className?: string;
}

/**
 * The one-tap add of a product card: a bar floating at the bottom of the
 * card image, which clips it while it is parked. It rides up from under the
 * image on hover or keyboard focus, on the same eased overshoot the buttons
 * use, and simply stays out where there is no hover.
 */
export const QuickAddButton = ({ label, onClick, className }: QuickAddButtonProps) => (
  <Button
    type="button"
    onClick={(event) => {
      // A mouse click leaves the button focused, and the cart drawer hands
      // that focus back when it closes — with Escape, the bar would then
      // stay out on a card nobody points at. A keyboard activation (`detail`
      // is 0) keeps its focus: it needs it back.
      if (event.detail > 0) event.currentTarget.blur();
      onClick();
    }}
    className={cn(
      // Floating 6px inside the image frame: its 8px radius is concentric
      // with the frame's 14px (outer radius = inner radius + gap).
      "absolute inset-x-1 bottom-1 z-10 h-8 rounded-xl font-medium",
      // Parked below the frame — its full height plus the 6px gap.
      "translate-y-[calc(100%+0.375rem)] pointer-coarse:translate-y-0",
      // Shown on hover and on keyboard focus only: `:focus-within` would keep
      // it out after a click, once the cart drawer hands the focus back.
      "group-hover:translate-y-0 focus-visible:translate-y-0 group-has-[a:focus-visible]:translate-y-0",
      "motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.34,1.4,0.64,1)]",
      className,
    )}
  >
    <BagPlusIcon className="size-4" />
    {label}
  </Button>
);
