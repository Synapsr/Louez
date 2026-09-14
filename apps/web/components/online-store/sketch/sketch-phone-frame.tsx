import type { ReactNode } from "react";

import { cn } from "@louez/utils";

import {
  SKETCH_DESIGN_WIDTH,
  SKETCH_PHONE_SCREEN_HEIGHT,
  type SketchPalette,
} from "./sketch-palette";
import { SketchPhoneStatusBar } from "./sketch-phone-status-bar";

interface SketchPhoneFrameProps {
  palette: SketchPalette;
  /** CSS `zoom` that fits the phone to the canvas. */
  zoom: number;
  children: ReactNode;
}

/** Action button and volume rocker on the left, side button on the right. */
const SIDE_BUTTONS = [
  { id: "action", className: "-left-[3px] top-[17%] h-[3.5%] rounded-l-[2px]" },
  { id: "volume-up", className: "-left-[3px] top-[24%] h-[6.5%] rounded-l-[2px]" },
  { id: "volume-down", className: "-left-[3px] top-[32%] h-[6.5%] rounded-l-[2px]" },
  { id: "side", className: "-right-[3px] top-[27%] h-[10%] rounded-r-[2px]" },
] as const;

/**
 * A phone drawn as the device, at an iPhone's own sizes: a metal band and a
 * black border (together `SKETCH_PHONE_BEZEL`), a 390 × 844 screen with
 * concentric corners, the Dynamic Island, the status bar and the home
 * indicator. The page scrolls inside the screen; the phone never stretches.
 * The side buttons come first in the DOM so the body paints over their
 * inner half.
 */
export const SketchPhoneFrame = ({ palette: p, zoom, children }: SketchPhoneFrameProps) => (
  <div className="relative shrink-0" style={{ zoom }} data-slot="sketch-phone-frame">
    {SIDE_BUTTONS.map(({ id, className }) => (
      <span key={id} className={cn("absolute w-1 bg-zinc-600", className)} />
    ))}
    <div className="relative rounded-[59px] bg-linear-to-br from-zinc-400 via-zinc-700 to-zinc-500 p-[3px] shadow-2xl shadow-black/25 ring-1 ring-black/10 dark:ring-white/10">
      <div className="rounded-[56px] bg-zinc-950 p-[9px]">
        <div
          className={cn(
            "relative flex flex-col overflow-hidden rounded-[47px] transition-colors duration-300",
            p.page,
          )}
          style={{ width: SKETCH_DESIGN_WIDTH.phone, height: SKETCH_PHONE_SCREEN_HEIGHT }}
        >
          <span className="absolute top-[11px] left-1/2 z-10 h-[37px] w-[126px] -translate-x-1/2 rounded-full bg-black" />
          <SketchPhoneStatusBar palette={p} />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {children}
          </div>
          <span
            className={cn(
              "pointer-events-none absolute bottom-2 left-1/2 z-10 h-[5px] w-[134px] -translate-x-1/2 rounded-full opacity-80 transition-colors duration-300",
              p.ink,
            )}
          />
        </div>
      </div>
    </div>
  </div>
);
