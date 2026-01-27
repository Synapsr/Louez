import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { AppearanceForm } from './appearance-form'

export default async function AppearancePage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings')

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        {t('appearanceSettings.description')}
      </p>

      <AppearanceForm store={store} />
    </div>
  )
}
