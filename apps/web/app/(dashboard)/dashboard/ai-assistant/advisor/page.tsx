import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { isAIChatConfigured } from "@/lib/ai/provider";
import { getStorePlan } from "@/lib/plan-limits";
import { getCurrentStore } from "@/lib/store-context";
import { StoreSettingsAccess } from "@/components/dashboard/store-settings-access";

import { AiAdvisorForm } from "../ai-advisor-form";
import { AiAssistantSettingsChrome } from "../settings-chrome";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The web advisor's configuration: the assistant your customers meet on the
 * storefront. Split out of the old three-tab assistant page so the setting has
 * an address of its own.
 */
export default async function AiAdvisorPage({
  searchParams,
}: {
  searchParams: Promise<{ topup?: string }>;
}) {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const [{ topup }, t, plan] = await Promise.all([
    searchParams,
    getTranslations("dashboard.aiAssistant.pages"),
    getStorePlan(store.id),
  ]);

  return (
    <AiAssistantSettingsChrome
      topup={topup}
      title={t("advisor.title")}
      description={t("advisor.description")}
    >
      <StoreSettingsAccess>
        <AiAdvisorForm
          store={{ id: store.id, aiAdvisorSettings: store.aiAdvisorSettings }}
          hasFeatureAccess={plan.features.aiAdvisor}
          aiConfigured={isAIChatConfigured()}
        />
      </StoreSettingsAccess>
    </AiAssistantSettingsChrome>
  );
}
