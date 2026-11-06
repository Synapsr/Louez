import type { ComponentType, ReactNode } from "react";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";

interface SignInMethodRowProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  /** Current state of the method: the address, "not set", "set on …". */
  status: ReactNode;
  /** Badge or action buttons on the right. */
  children?: ReactNode;
}

/** One sign-in method of the account page's "Sign-in" card. */
export const SignInMethodRow = ({ icon, title, status, children }: SignInMethodRowProps) => (
  <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <DashboardIconTile icon={icon} size="sm" />
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground truncate text-sm">{status}</p>
      </div>
    </div>
    {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
  </li>
);
