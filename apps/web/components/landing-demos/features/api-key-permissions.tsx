"use client";
import { useTranslations } from "next-intl";
import { ApiKeysPageContent } from "@/app/(dashboard)/dashboard/settings/integrations/mcp/api-keys-page-content";
import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { getDemoApiKeys } from "@/lib/landing-demos/api-keys";
import { SettingsSceneFrame } from "../settings-scene-frame";

/** The API keys page: the keys of the shop, then a new key with its rights domain by domain. */
export const ApiKeyPermissionsScene = () => {
  const t = useTranslations("dashboard.settings.api");
  const tHub = useTranslations("dashboard.settings.integrationsHub");
  return (
    <SettingsSceneFrame pathname="/dashboard/settings/integrations/mcp">
      <SettingsPageShell
        back={{ href: "#", label: t("backToIntegrations") }}
        title={tHub("builtIn.mcp.name")}
        description={t("description")}
      >
        <div data-demo-scene="api-key-permissions">
          <ApiKeysPageContent keys={getDemoApiKeys()} readOnly />
        </div>
      </SettingsPageShell>
    </SettingsSceneFrame>
  );
};
