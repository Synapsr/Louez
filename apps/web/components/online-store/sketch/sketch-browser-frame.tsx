import type { ReactNode } from "react";

import { cn } from "@louez/utils";

import { SKETCH_DESIGN_WIDTH, type SketchPalette } from "./sketch-palette";

interface SketchBrowserFrameProps {
  palette: SketchPalette;
  /** CSS `zoom` that fits the window to the canvas width. */
  zoom: number;
  /** The window's height before zoom, so that it fills the canvas. */
  height: number;
  children: ReactNode;
}

/**
 * A desktop window reduced to its viewport: no address bar, no tab, no
 * traffic lights, just the page in a rounded frame. The window is as tall
 * as the canvas and the page scrolls inside it. The favicon is checked on
 * the search section, in the Google result, where it matters.
 */
export const SketchBrowserFrame = ({
  palette: p,
  zoom,
  height,
  children,
}: SketchBrowserFrameProps) => (
  <div
    className={cn(
      "flex shrink-0 flex-col overflow-hidden rounded-2xl shadow-xl shadow-black/5 ring-1 ring-foreground/10 transition-colors duration-300",
      p.page,
    )}
    style={{ zoom, width: SKETCH_DESIGN_WIDTH.desktop, height }}
    data-slot="sketch-browser-frame"
  >
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
  </div>
);
