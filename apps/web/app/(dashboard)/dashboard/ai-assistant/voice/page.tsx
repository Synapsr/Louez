import { redirect } from "next/navigation";

import { and, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { db, storePhoneNumbers } from "@louez/db";

import { env } from "@/env";
import { isVoiceAgentConfigured } from "@/lib/ai/phone/eligibility";
import { hasNumberRentalFunds } from "@/lib/ai/phone/number-billing";
import { getNumberRentalCredits, getPhoneCreditsPerMinute } from "@/lib/ai/pricing";
import { getStorePlan } from "@/lib/plan-limits";
import { getCurrentStore } from "@/lib/store-context";

import { AiAssistantSettingsChrome } from "../settings-chrome";
import { VoiceAgentForm } from "../voice-agent-form";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The voice agent's configuration: the number it answers on, how it greets
 * callers, and what it is allowed to do for them.
 */
export default async function AiVoiceAgentPage({
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

  const [phoneBinding, rentalFundsOk] = await Promise.all([
    db.query.storePhoneNumbers.findFirst({
      where: and(eq(storePhoneNumbers.storeId, store.id), eq(storePhoneNumbers.status, "active")),
      columns: { e164: true, providerNumberId: true },
    }),
    hasNumberRentalFunds(store.id, plan),
  ]);

  // Commercial voice tariffs (env-driven; 0 ⇒ not configured / free).
  const numberRentalCredits = getNumberRentalCredits();
  const voiceCreditsPerMinute = getPhoneCreditsPerMinute();

  return (
    <AiAssistantSettingsChrome
      topup={topup}
      title={t("voice.title")}
      description={t("voice.description")}
    >
      <VoiceAgentForm
        store={{ id: store.id, aiPhoneSettings: store.aiPhoneSettings }}
        hasFeatureAccess={plan.features.aiPhone}
        phoneConfigured={isVoiceAgentConfigured()}
        boundNumber={phoneBinding?.e164 ?? null}
        isProvisioned={Boolean(phoneBinding?.providerNumberId)}
        webhookUrl={`${env.NEXT_PUBLIC_APP_URL}/api/voice/incoming`}
        defaultCountry="FR"
        defaultVoice={env.AI_PHONE_DEFAULT_VOICE}
        numberRentalCredits={numberRentalCredits > 0 ? numberRentalCredits : null}
        voiceCreditsPerMinute={voiceCreditsPerMinute > 0 ? voiceCreditsPerMinute : null}
        hasRentalFunds={rentalFundsOk}
      />
    </AiAssistantSettingsChrome>
  );
}
