"use client";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Logo,
  Sidebar,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
} from "@louez/ui";
import { DashboardBreadcrumbs } from "@/components/dashboard/dashboard-breadcrumbs";
import { DashboardBreadcrumbsProvider } from "@/components/dashboard/dashboard-breadcrumbs-context";
import { DashboardContentFrame } from "@/components/dashboard/dashboard-content-frame";
import { DashboardNavigation } from "@/components/dashboard/dashboard-navigation";
import { UserAvatar } from "@/components/dashboard/shared/user-avatar";
import { getDemoText } from "@/lib/landing-demos/text";
import { useDemoLocale } from "./use-demo-locale";

// The sidebar entry each demo page lights up, and its label in `dashboard.navigation`.
const PAGES = {
  dashboard: { href: "/dashboard", label: "home" },
  reservations: { href: "/dashboard/reservations", label: "reservations" },
  customers: { href: "/dashboard/customers", label: "customers" },
  products: { href: "/dashboard/products", label: "products" },
  analytics: { href: "/dashboard/analytics/sales", label: "analytics" },
  team: { href: "/dashboard/team", label: "team" },
  settings: { href: "/dashboard/settings", label: "settings" },
} as const;
export type DashboardScenePage = keyof typeof PAGES;
const isScenePage = (value: string): value is DashboardScenePage => value in PAGES;

export const DashboardSceneFrame = ({
  page,
  pages = [page],
  pathname,
  onNavigate,
  breadcrumbs,
  children,
}: {
  page: DashboardScenePage;
  /** Sidebar entries the visitor can open; every other entry is shown disabled. */
  pages?: DashboardScenePage[];
  /**
   * The dashboard path of a page deeper than a sidebar entry (`/dashboard/products/demo-city-bike`,
   * `/dashboard/settings/delivery`): the top bar then shows the real breadcrumb trail, fed by the
   * page's own `DashboardBreadcrumbLabel`.
   */
  pathname?: string;
  onNavigate?: (page: DashboardScenePage) => void;
  breadcrumbs?: ReactNode;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(true);
  const t = useTranslations("dashboard.navigation");
  const text = getDemoText(useDemoLocale());
  return (
    <DashboardBreadcrumbsProvider pathname={pathname ?? PAGES[page].href}>
      <div className="dashboard relative h-svh overflow-hidden">
        <SidebarProvider
          open={open}
          onOpenChange={setOpen}
          className="h-full min-h-0 overflow-hidden"
        >
          <Sidebar variant="inset" collapsible="icon">
            <SidebarHeader className="border-sidebar-border gap-3 border-b px-4 py-3">
              <Logo className="h-5 w-auto self-start group-data-[collapsible=icon]:hidden" />
              <div className="flex items-center gap-2 py-2">
                <UserAvatar seed="maison-du-velo" size={28} />
                <span className="truncate text-sm font-medium group-data-[collapsible=icon]:hidden">
                  Maison du Vélo
                </span>
              </div>
            </SidebarHeader>
            <DashboardNavigation
              pathname={PAGES[page].href}
              localNavigation={{
                href: "/demos/landing/planning",
                availableHrefs: pages.map((key) => PAGES[key].href),
                onNavigate: (href) => {
                  for (const key of Object.keys(PAGES)) {
                    if (isScenePage(key) && PAGES[key].href === href) onNavigate?.(key);
                  }
                },
              }}
            />
            <SidebarFooter className="border-sidebar-border flex-row items-center gap-2 border-t p-3">
              <UserAvatar seed="demo-loueur" size={28} />
              <span className="text-sm group-data-[collapsible=icon]:hidden">Maison du Vélo</span>
            </SidebarFooter>
          </Sidebar>
          <DashboardContentFrame
            trigger={<SidebarTrigger aria-label={text.toggleMenu} />}
            breadcrumbs={
              breadcrumbs ??
              (pathname ? (
                <DashboardBreadcrumbs inert />
              ) : (
                <span className="text-sm font-medium">{t(PAGES[page].label)}</span>
              ))
            }
          >
            {children}
          </DashboardContentFrame>
        </SidebarProvider>
      </div>
    </DashboardBreadcrumbsProvider>
  );
};
