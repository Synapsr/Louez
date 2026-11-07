import type { ComponentType, ReactNode } from "react";

import { cn } from "@louez/utils";

import { DASHBOARD_ACCENT_SURFACE, type DashboardAccent } from "./dashboard-accent";

type DashboardIconTileProps = {
  accent?: DashboardAccent;
  /** `sm` for stat cards and dense rows, `md` for section headers. */
  size?: "sm" | "md";
  className?: string;
} & (
  | { icon: ComponentType<{ className?: string }>; children?: never }
  /** An image instead of the icon (a site's icon), drawn at the icon's size by the caller. */
  | { icon?: never; children: ReactNode }
);

/** The single icon-container shape used across the dashboard. */
export const DashboardIconTile = ({
  icon: Icon,
  accent = "neutral",
  size = "md",
  className,
  children,
}: DashboardIconTileProps) => (
  <span
    aria-hidden="true"
    className={cn(
      "relative isolate flex shrink-0 items-center justify-center overflow-hidden rounded-lg",
      size === "sm" ? "size-8" : "size-9",
      DASHBOARD_ACCENT_SURFACE[accent],
      className,
    )}
  >
    {/* Fades the accent surface into the surrounding card so the tile reads as a
        soft dome. Uses `--card` rather than a hard white: it is white in light
        mode (the original value) and dark in dark mode, where a white rim glowed. */}
    <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_50%,var(--card)_105%)]" />
    {Icon ? (
      <Icon className={cn("relative z-10", size === "sm" ? "size-4" : "size-4.5")} />
    ) : (
      <span className="relative z-10 flex">{children}</span>
    )}
  </span>
);
