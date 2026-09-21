"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { Alert, AlertDescription, DisabledControlsProvider } from "@louez/ui";
import { useStoreHasPermission } from "@/contexts/store-context";

/** A presentation guard; every mutation must still enforce its server permission. */
export const StoreSettingsAccess = ({ children }: { children: ReactNode }) => {
  const hasManagementPermission = useStoreHasPermission("manage_settings");
  const pathname = usePathname();
  // Copying referral/widget links is available to all members; exports require manage_settings.
  const readOnlyTools = [
    "/dashboard/settings/referrals",
    "/dashboard/settings/integrations/widget",
  ];
  const canManage =
    hasManagementPermission ||
    readOnlyTools.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const t = useTranslations("dashboard.settings");

  return (
    <DisabledControlsProvider disabled={!canManage}>
      {!canManage && (
        <Alert className="mb-4">
          <AlertDescription>{t("readOnlyNotice")}</AlertDescription>
        </Alert>
      )}
      <div
        className="min-w-0"
        onSubmitCapture={(event) => {
          if (!canManage) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {children}
      </div>
    </DisabledControlsProvider>
  );
};
