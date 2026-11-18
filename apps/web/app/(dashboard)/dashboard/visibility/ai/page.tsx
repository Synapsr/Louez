import { redirect } from "next/navigation";

import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card } from "@louez/ui";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import { AiVisibilityOverview } from "@/components/dashboard/visibility/ai-visibility-overview";
import { canUseAiVisibility } from "@/lib/ai-visibility/entitlement";
import { serverApi } from "@/lib/api/server-api";
import { isSearchIndexingEnabled } from "@/lib/search-indexing";
import { getCurrentStore } from "@/lib/store-context";
import { getStorefrontUrl } from "@/lib/storefront-url";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * « Être trouvé par les IA », always reachable from the sidebar: before the
 * store is online too, its readiness is worth fixing then.
 */
export default async function VisibilityAiPage() {
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");

  if (!(await canUseAiVisibility(store))) {
    const t = await getTranslations("dashboard.visibility.ai");
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <Card className="items-center pb-8">
          <DashboardEmptyState
            icon={Sparkles}
            title={t("notIncluded.title")}
            description={t("notIncluded.description")}
          />
        </Card>
      </div>
    );
  }

  const api = await serverApi();
  const [view, checklist] = await Promise.all([
    api.visibility.getAi({}),
    api.stores.getLaunchChecklist({}),
  ]);

  return (
    <AiVisibilityOverview
      storeId={store.id}
      initialView={view}
      llmsTxtUrl={checklist.online ? getStorefrontUrl(store.slug, "/llms.txt") : null}
      indexingEnabled={isSearchIndexingEnabled()}
    />
  );
}
