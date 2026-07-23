import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'

import { db, storePhoneNumbers } from '@louez/db'

import { env } from '@/env'
import { getCurrentStore } from '@/lib/store-context'
import { getStorePlan } from '@/lib/plan-limits'
import { isAIChatConfigured } from '@/lib/ai/provider'
import { isVoiceAgentConfigured } from '@/lib/ai/phone/eligibility'
import { hasNumberRentalFunds } from '@/lib/ai/phone/number-billing'
import {
  getAiCreditHistory,
  getAiCreditsInfo,
  microToCredits,
} from '@/lib/ai/advisor/credits'
import {
  getNumberRentalCredits,
  getPhoneCreditsPerMinute,
} from '@/lib/ai/pricing'
import { areAiCreditsEnabled, getAiCreditPackages } from '@/lib/plans'
import { AiAdvisorForm } from './ai-advisor-form'
import { AiAssistantHeader } from './ai-assistant-header'
import { AiAssistantHero } from './ai-assistant-hero'
import { VoiceAgentForm } from './voice-agent-form'
import {
  AiCreditsSection,
  type AiCreditsSectionProps,
} from './ai-credits-section'
import { AdvisorConversationsSection } from './conversations-section'

/**
 * The AI assistant's home: one page selling and driving both faces of the
 * assistant (web advisor + voice agent), with the credit wallet pinned in the
 * sticky header. When nothing is enabled yet, a marketing hero shows what the
 * assistant can do instead of dropping the merchant into settings.
 */
export default async function AiAssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ topup?: string }>
}) {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const plan = await getStorePlan(store.id)

  // Commercial voice tariffs (env-driven; 0 ⇒ not configured / free).
  const numberRentalCredits = getNumberRentalCredits()
  const voiceCreditsPerMinute = getPhoneCreditsPerMinute()

  // Credit layer is a cloud-only commercial add-on: only load and render it
  // when the operator has enabled it via env (self-host never sees it).
  let credits: AiCreditsSectionProps | null = null
  let headerCredits: { totalCredits: number | null; low: boolean } | null = null
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
      topupStatus: topup === 'success' || topup === 'cancelled' ? topup : null,
      returnPath: '/dashboard/ai-assistant',
      voiceCreditsPerMinute:
        voiceCreditsPerMinute > 0 ? voiceCreditsPerMinute : null,
      numberRentalCredits:
        numberRentalCredits > 0 ? numberRentalCredits : null,
    }
    headerCredits = {
      totalCredits:
        info.monthlyRemainingMicro === null
          ? null
          : microToCredits(
              info.monthlyRemainingMicro + info.prepaidBalanceMicro,
            ),
      low:
        info.monthlyRemainingMicro !== null &&
        microToCredits(info.monthlyRemainingMicro + info.prepaidBalanceMicro) <
          5,
    }
  }

  const [phoneBinding, rentalFundsOk] = await Promise.all([
    db.query.storePhoneNumbers.findFirst({
      where: and(
        eq(storePhoneNumbers.storeId, store.id),
        eq(storePhoneNumbers.status, 'active'),
      ),
      columns: { e164: true, providerNumberId: true },
    }),
    hasNumberRentalFunds(store.id, plan),
  ])

  const advisorEnabled = store.aiAdvisorSettings?.enabled === true
  const voiceEnabled = store.aiPhoneSettings?.enabled === true
  const showHero = !advisorEnabled && !voiceEnabled

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl">
      <AiAssistantHeader
        credits={headerCredits}
        packages={credits?.packages ?? []}
        voiceCreditsPerMinute={
          voiceCreditsPerMinute > 0 ? voiceCreditsPerMinute : null
        }
        numberRentalCredits={
          numberRentalCredits > 0 ? numberRentalCredits : null
        }
      />

      <div className="space-y-4 py-4 sm:space-y-6 sm:py-6">
        {showHero && (
          <AiAssistantHero
            hasAdvisorAccess={plan.features.aiAdvisor}
            hasVoiceAccess={plan.features.aiPhone}
          />
        )}

        <div id="voice-section" className="scroll-mt-20">
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
            numberRentalCredits={
              numberRentalCredits > 0 ? numberRentalCredits : null
            }
            voiceCreditsPerMinute={
              voiceCreditsPerMinute > 0 ? voiceCreditsPerMinute : null
            }
            hasRentalFunds={rentalFundsOk}
          />
        </div>

        <div id="advisor-section" className="scroll-mt-20">
          <AiAdvisorForm
            store={{
              id: store.id,
              aiAdvisorSettings: store.aiAdvisorSettings,
            }}
            hasFeatureAccess={plan.features.aiAdvisor}
            aiConfigured={isAIChatConfigured()}
          />
        </div>

        {credits && <AiCreditsSection {...credits} />}

        <AdvisorConversationsSection />
      </div>
    </div>
  )
}
