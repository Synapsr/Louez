"use client";

import type { KeyboardEvent } from "react";

import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import type { ResizablePanel } from "../use-resizable-panel";

interface OnlineStoreResizeHandleProps {
  panel: ResizablePanel;
  className?: string;
}

/** Pixels per arrow key press; Shift makes it a big step. */
const KEY_STEP = 16;
const KEY_BIG_STEP = 96;

/**
 * The line between the panel and the sketch, dragged to change the panel's
 * width. A thin rule with a wide grab area, that lights up on hover and
 * while dragging; a separator for assistive tech, with the arrow keys,
 * Home, End and Enter (reset) on the keyboard.
 */
export const OnlineStoreResizeHandle = ({ panel, className }: OnlineStoreResizeHandleProps) => {
  const t = useTranslations("dashboard.onlineStore");

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_BIG_STEP : KEY_STEP;
    switch (event.key) {
      case "ArrowLeft":
        panel.resizeBy(-step);
        break;
      case "ArrowRight":
        panel.resizeBy(step);
        break;
      case "Home":
        panel.resizeTo(panel.min);
        break;
      case "End":
        panel.resizeTo(panel.max);
        break;
      case "Enter":
        panel.reset();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("resizePanel")}
      aria-valuemin={panel.min}
      aria-valuemax={panel.max}
      aria-valuenow={panel.width}
      tabIndex={0}
      onPointerDown={panel.startDrag}
      onPointerMove={panel.drag}
      onPointerUp={panel.endDrag}
      onPointerCancel={panel.endDrag}
      onDoubleClick={panel.reset}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative z-10 -mx-1.5 w-3 shrink-0 cursor-col-resize touch-none focus-visible:outline-none",
        className,
      )}
      data-slot="online-store-resize-handle"
      data-dragging={panel.dragging || undefined}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-[background-color,width] duration-150",
          "group-hover:w-0.5 group-hover:bg-primary/60 group-focus-visible:w-0.5 group-focus-visible:bg-primary",
          panel.dragging && "w-0.5 bg-primary",
        )}
      />
    </div>
  );
};
