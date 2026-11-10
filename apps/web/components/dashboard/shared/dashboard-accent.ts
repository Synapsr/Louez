/**
 * Accent palette shared by every dashboard widget (home, analytics, …).
 *
 * Widgets used to bring their own colours (emerald / blue / orange / purple
 * Tailwind palettes, plus hand-written gradients in `dashboard-theme.css`), so
 * an icon tile and the badge sitting next to it never matched. Everything now
 * resolves to the badge tokens from `@louez/ui`: an accent gives the tile the
 * exact background/foreground pair its `<Badge variant>` counterpart uses.
 */
export type DashboardAccent =
  | "success"
  | "progress"
  | "pending"
  | "submitted"
  | "review"
  | "neutral"
  | "primary"
  // Something that should have happened and did not: overdue hand-overs and returns.
  | "failed";

/** Background + foreground pair for an accented surface (icon tile, dot, …). */
export const DASHBOARD_ACCENT_SURFACE: Record<DashboardAccent, string> = {
  success: "bg-badge-success-background text-badge-success-foreground",
  progress: "bg-badge-progress-background text-badge-progress-foreground",
  pending: "bg-badge-pending-background text-badge-pending-foreground",
  submitted: "bg-badge-submitted-background text-badge-submitted-foreground",
  review: "bg-badge-review-background text-badge-review-foreground",
  neutral: "bg-badge-expired-background text-badge-expired-foreground",
  primary: "bg-primary/10 text-primary",
  failed: "bg-badge-failed-background text-badge-failed-foreground",
};

/** Solid fill for charts and progress bars — the accent's foreground colour. */
export const DASHBOARD_ACCENT_FILL: Record<DashboardAccent, string> = {
  success: "bg-badge-success-foreground",
  progress: "bg-badge-progress-foreground",
  pending: "bg-badge-pending-foreground",
  submitted: "bg-badge-submitted-foreground",
  review: "bg-badge-review-foreground",
  neutral: "bg-badge-expired-foreground",
  primary: "bg-primary",
  failed: "bg-badge-failed-foreground",
};
