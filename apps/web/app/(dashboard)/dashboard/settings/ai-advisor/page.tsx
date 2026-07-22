import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'

import { db, storePhoneNumbers } from '@louez/db'

import { env } from '@/env'
import { getCurrentStore } from '@/lib/store-context'
import { getStorePlan } from '@/lib/plan-limits'
import { isAIChatConfigured } from '@/lib/ai/provider'
import { isVoiceAgentConfigured } from '@/lib/ai/phone/eligibility'
import { getVoiceCatalog } from '@/lib/voice/config'
import {
  getAiCreditHistory,
  getAiCreditsInfo,
  microToCredits,
} from '@/lib/ai/advisor/credits'
import { areAiCreditsEnabled, getAiCreditPackages } from '@/lib/plans'
import { AiAdvisorForm } from './ai-advisor-form'
import { VoiceAgentForm } from './voice-agent-form'
import {
  AiCreditsSection,
  type AiCreditsSectionProps,
} from './ai-credits-section'
import { AdvisorConversationsSection } from './conversations-section'

export default async function AiAdvisorSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ topup?: string }>
}) {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const plan = await getStorePlan(store.id)

  const t = await getTranslations('dashboard.settings')

  // Credit layer is a cloud-only commercial add-on: only load and render it
  // when the operator has enabled it via env (self-host never sees it).
  let credits: AiCreditsSectionProps | null = null
  if (areAiCreditsEnabled()) {
    const [info, historyRows, { topup }] = await Promise.all([
      getAiCreditsInfo(store.id, plan),
      getAiCreditHistory(store.id, 10),
      searchParams,
    ])
    const packages = getAiCreditPackages()
    credits = {
      monthlyIncludedCredits:
        info.monthlyIncludedMicro === null
          ? null
          : microToCredits(info.monthlyIncludedMicro),
      monthlyRemainingCredits:
        info.monthlyRemainingMicro === null
          ? null
          : microToCredits(info.monthlyRemainingMicro),
      prepaidCredits: microToCredits(info.prepaidBalanceMicro),
      autoTopup: {
        enabled: info.autoTopupEnabled,
        thresholdCredits: info.autoTopupThresholdMicro
          ? microToCredits(info.autoTopupThresholdMicro)
          : 0,
        packIndex: packages.findIndex(
          (p) =>
            p.credits === info.autoTopupCredits &&
            p.priceCents === info.autoTopupPriceCents,
        ),
      },
      packages,
      history: historyRows.map((r) => ({
        id: r.id,
        type: r.type,
        credits: microToCredits(r.creditsMicro),
        amountCents: r.amountCents,
        currency: r.currency,
        status: r.status,
        createdAt: r.createdAt,
      })),
      topupStatus:
        topup === 'success' || topup === 'cancelled' ? topup : null,
    }
  }

  const phoneBinding = await db.query.storePhoneNumbers.findFirst({
    where: and(
      eq(storePhoneNumbers.storeId, store.id),
      eq(storePhoneNumbers.status, 'active'),
    ),
    columns: { e164: true, providerNumberId: true },
  })

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-4 sm:space-y-6">
      <p className="text-sm sm:text-base text-muted-foreground">
        {t('aiAdvisor.description')}
      </p>

      <AiAdvisorForm
        store={{
          id: store.id,
          aiAdvisorSettings: store.aiAdvisorSettings,
        }}
        hasFeatureAccess={plan.features.aiAdvisor}
        aiConfigured={isAIChatConfigured()}
      />

      <VoiceAgentForm
        store={{
          id: store.id,
          aiPhoneSettings: store.aiPhoneSettings,
        }}
        hasFeatureAccess={plan.features.aiPhone}
        phoneConfigured={isVoiceAgentConfigured()}
        boundNumber={phoneBinding?.e164 ?? null}
        isProvisioned={Boolean(phoneBinding?.providerNumberId)}
        webhookUrl={`${env.NEXT_PUBLIC_APP_URL}/api/voice/incoming`}
        defaultCountry="FR"
        voiceCatalog={getVoiceCatalog()}
      />

      {credits && <AiCreditsSection {...credits} />}

      <AdvisorConversationsSection />
    </div>
  )
}
