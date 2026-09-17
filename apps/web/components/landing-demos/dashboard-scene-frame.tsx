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
import { DashboardContentFrame } from "@/components/dashboard/dashboard-content-frame";
import { DashboardNavigation } from "@/components/dashboard/dashboard-navigation";
import { UserAvatar } from "@/components/dashboard/shared/user-avatar";
import { getDemoText } from "@/lib/landing-demos/text";
import { useDemoLocale } from "./use-demo-locale";

export const DashboardSceneFrame = ({
  page,
  onNavigate,
  children,
}: {
  page: "dashboard" | "reservations";
  onNavigate: (page: "dashboard" | "reservations") => void;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(true);
  const t = useTranslations("dashboard.navigation");
  const text = getDemoText(useDemoLocale());
  return (
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
            pathname={page === "dashboard" ? "/dashboard" : "/dashboard/reservations"}
            localNavigation={{
              href: "/demos/landing/planning",
              availableHrefs: ["/dashboard", "/dashboard/reservations"],
              onNavigate: (href) => {
                if (href === "/dashboard") onNavigate("dashboard");
                if (href === "/dashboard/reservations") onNavigate("reservations");
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
            <span className="text-sm font-medium">
              {t(page === "dashboard" ? "home" : "reservations")}
            </span>
          }
        >
          {children}
        </DashboardContentFrame>
      </SidebarProvider>
    </div>
  );
};
