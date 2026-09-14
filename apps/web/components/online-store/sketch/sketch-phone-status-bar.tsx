import { cn } from "@louez/utils";

import type { SketchPalette } from "./sketch-palette";

interface SketchPhoneStatusBarProps {
  palette: SketchPalette;
}

/**
 * The iOS status bar at its own size: the time in the left ear, signal,
 * Wi-Fi and battery in the right one, both on the Dynamic Island's centre
 * line. Glyphs take the page's text colour, so a dark store gets a light
 * status bar.
 */
export const SketchPhoneStatusBar = ({ palette: p }: SketchPhoneStatusBarProps) => (
  <div
    className={cn(
      "grid h-[59px] shrink-0 grid-cols-[1fr_126px_1fr] items-center transition-colors duration-300",
      p.text,
    )}
    data-slot="sketch-phone-status-bar"
  >
    <span className="justify-self-center text-[17px] font-semibold tabular-nums leading-none tracking-tight">
      9:41
    </span>
    <span />
    <span className="flex items-center gap-1.5 justify-self-center">
      <svg viewBox="0 0 17 11" className="h-3 w-auto" fill="currentColor">
        <rect x="0" y="7" width="3" height="4" rx="0.8" />
        <rect x="4.5" y="5" width="3" height="6" rx="0.8" />
        <rect x="9" y="2.5" width="3" height="8.5" rx="0.8" />
        <rect x="13.5" y="0" width="3" height="11" rx="0.8" />
      </svg>
      <svg viewBox="0 0 16 12" className="h-3 w-auto">
        <path
          d="M1.5 4.2a9.2 9.2 0 0 1 13 0M4.2 7a5.4 5.4 0 0 1 7.6 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="8" cy="10.4" r="1.5" fill="currentColor" />
      </svg>
      <svg viewBox="0 0 25 12" className="h-[13px] w-auto">
        <rect
          x="0.5"
          y="0.5"
          width="21"
          height="11"
          rx="3.5"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.4"
        />
        <rect x="2" y="2" width="18" height="8" rx="2" fill="currentColor" />
        <path d="M23 4v4a2.2 2.2 0 0 0 0-4Z" fill="currentColor" fillOpacity="0.4" />
      </svg>
    </span>
  </div>
);
