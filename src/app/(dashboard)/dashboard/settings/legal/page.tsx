import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { SettingsNav } from '@/components/dashboard/settings-nav'
import { LegalPagesForm } from './legal-pages-form'

export default async function LegalPagesPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings')

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">
          {t('legalSettings.description')}
        </p>
      </div>

      <SettingsNav />

      <LegalPagesForm store={store} />
    </div>
  )
}
