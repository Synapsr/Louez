"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SettingsNav } from "@/components/dashboard/settings-nav";
import { StoreSettingsAccess } from "@/components/dashboard/store-settings-access";
import { DashboardSceneFrame } from "./dashboard-scene-frame";

/**
 * A settings page as the dashboard lays it out: the settings title, the settings menu on the
 * page given by `pathname`, then the page, which brings its own `SettingsPageShell`.
 */
export const SettingsSceneFrame = ({
  pathname,
  children,
}: {
  /** For instance `/dashboard/settings/delivery`. */
  pathname: string;
  children: ReactNode;
}) => {
  const t = useTranslations("dashboard.settings");
  return (
    <DashboardSceneFrame page="settings" pathname={pathname}>
      <div className="space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t("title")}</h1>
        </div>
        <div className="flex flex-col gap-4 sm:gap-6 xl:grid xl:grid-cols-[260px_1fr] xl:gap-10">
          <SettingsNav pathname={pathname} onNavigate={() => undefined} />
          <main className="min-w-0">
            <StoreSettingsAccess>{children}</StoreSettingsAccess>
          </main>
        </div>
      </div>
    </DashboardSceneFrame>
  );
};
