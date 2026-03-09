import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getCurrentStore } from '@/lib/store-context'
import { ApiKeysPageContent } from './api-keys-page-content'

export default async function ApiSettingsPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings.api')

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        {t('description')}
      </p>
      <ApiKeysPageContent />
    </div>
  )
}
