"use client";

import type { MouseEvent, ReactNode, Ref } from "react";

import { cn } from "@louez/utils";

interface CustomerFieldRowFrameProps {
  ref?: Ref<HTMLLIElement>;
  /** `toCanvasFieldKey` of the field: the inspector finds its way back to it. */
  canvasKey: string;
  /** Names the row's button: "Modifier « Taille »". */
  selectLabel: string;
  selected: boolean;
  /** A hidden field: greyed, still there to be picked and shown again. */
  muted: boolean;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Label, input and help, as the team gets them. */
  preview: ReactNode;
  /** The line under the input; never greyed, it says why the field looks as it does. */
  badges: ReactNode;
  /** The drag handle of a store field; Louez fields keep its room empty so labels line up. */
  handle?: ReactNode;
  /** The "⋯" of a store field, over the label's line. */
  menu?: ReactNode;
  /** A yes/no box fills the row to its end: the "⋯" then needs room of its own. */
  wideInput?: boolean;
  isDragging?: boolean;
}

/**
 * One editable field on the canvas, the same for the store's fields and the
 * Louez ones: its label, its input and a line of badges. A click anywhere
 * selects it; the handle and "⋯" wait for the pointer (always there on touch).
 */
export const CustomerFieldRowFrame = ({
  ref,
  canvasKey,
  selectLabel,
  selected,
  muted,
  onSelect,
  preview,
  badges,
  handle,
  menu,
  wideInput = false,
  isDragging = false,
}: CustomerFieldRowFrameProps) => (
  <li
    ref={ref}
    className={cn(
      "group/field relative rounded-xl transition-colors",
      selected ? "bg-primary/5 ring-2 ring-primary/50" : "hover:bg-muted/60",
      isDragging && "bg-card shadow-raised z-10",
    )}
  >
    <button
      type="button"
      // `CANVAS_FIELD_ATTRIBUTE`: how the inspector finds this field again.
      data-canvas-field={canvasKey}
      aria-pressed={selected}
      aria-label={selectLabel}
      className="absolute inset-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onSelect}
    />
    <div
      className={cn(
        "pointer-events-none relative flex items-start gap-1 py-3 ps-1 pe-2",
        menu && "pointer-coarse:pe-9",
        menu && wideInput && "pe-9",
      )}
    >
      {handle ?? <span aria-hidden className="w-6 shrink-0" />}
      <div inert className="min-w-0 flex-1">
        <div className={cn("transition-opacity", muted && "opacity-45")}>{preview}</div>
        {badges}
      </div>
    </div>
    {menu && (
      <div className="absolute end-1.5 top-2 opacity-0 transition-opacity group-hover/field:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
        {menu}
      </div>
    )}
  </li>
);
