import Link from "next/link";
import { redirect } from "next/navigation";

import { CodeIcon } from "@louez/ui/icons";
import { getTranslations } from "next-intl/server";

import { Button, Card, CardContent } from "@louez/ui";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { getCurrentStore } from "@/lib/store-context";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** The public REST API reference (packages/api platform/openapi.ts), a route handler, not a page. */
const API_REFERENCE_PATH = "/api/v1/docs";

export default async function ApiIntegrationPage() {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const t = await getTranslations("dashboard.settings.integrationsHub");
  const tEmbed = await getTranslations("dashboard.settings.embed");

  return (
    <SettingsPageShell
      back={{ href: "/dashboard/settings/integrations", label: tEmbed("backToIntegrations") }}
      title={t("builtIn.api.name")}
      description={t("builtIn.api.description")}
    >
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <CodeIcon className="text-muted-foreground h-7 w-7" />
          </div>
          <h3 className="text-lg font-medium">{t("builtIn.api.betaTitle")}</h3>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            {t("builtIn.api.betaDescription")}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button render={<a href={API_REFERENCE_PATH} target="_blank" rel="noopener" />}>
              {t("builtIn.api.openReference")}
            </Button>
            <Button
              variant="outline"
              render={<Link href="/dashboard/settings/integrations/mcp#api-keys" />}
            >
              {t("builtIn.api.createKey")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </SettingsPageShell>
  );
}
