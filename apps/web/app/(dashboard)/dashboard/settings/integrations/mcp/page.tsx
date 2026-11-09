import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { Separator } from "@louez/ui";

import { AgentConnectionsSection } from "@/components/agent-connections/agent-connections-section";
import { ConnectAgentGuide } from "@/components/agent-connections/connect-agent-guide";
import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { getMcpEndpoint } from "@/lib/agent-connections/mcp-endpoint";
import { getCurrentStore } from "@/lib/store-context";

import { ApiKeysPageContent } from "./api-keys-page-content";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function McpIntegrationPage() {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const t = await getTranslations("dashboard.settings.api");
  const tHub = await getTranslations("dashboard.settings.integrationsHub");

  return (
    <SettingsPageShell
      back={{ href: "/dashboard/settings/integrations", label: t("backToIntegrations") }}
      title={tHub("builtIn.mcp.name")}
      description={t("description")}
    >
      <div className="space-y-8">
        <ConnectAgentGuide {...getMcpEndpoint()} />
        <Separator />
        <AgentConnectionsSection />
        <Separator />
        <ApiKeysPageContent />
      </div>
    </SettingsPageShell>
  );
}
