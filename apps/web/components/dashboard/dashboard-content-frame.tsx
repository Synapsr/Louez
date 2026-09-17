import type { ReactNode } from "react";
import { Separator, SidebarInset } from "@louez/ui";
export const DashboardContentFrame = ({
  trigger,
  breadcrumbs,
  actions,
  children,
}: {
  trigger: ReactNode;
  breadcrumbs: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) => {
  return (
    <SidebarInset className="min-h-0 min-w-0 overflow-clip">
      <header className="bg-background/90 supports-backdrop-filter:bg-background/70 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-2.5 backdrop-blur">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {trigger}
          <Separator orientation="vertical" className="h-4 shrink-0" />
          {breadcrumbs}
        </div>
        {actions}
      </header>
      <div
        data-dashboard-content
        className="min-h-0 flex-1 overflow-x-clip overflow-y-auto overscroll-contain px-4 sm:px-6 lg:px-8"
      >
        <div className="min-h-full py-4 pb-2 md:py-6">{children}</div>
      </div>
    </SidebarInset>
  );
};
