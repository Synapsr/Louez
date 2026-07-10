import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { getStorePlan } from '@/lib/plan-limits'
import { isAIChatConfigured } from '@/lib/ai/provider'
import { AiAdvisorForm } from './ai-advisor-form'
import { AdvisorConversationsSection } from './conversations-section'

export default async function AiAdvisorSettingsPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const plan = await getStorePlan(store.id)

  const t = await getTranslations('dashboard.settings')

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

      <AdvisorConversationsSection />
    </div>
  )
}
