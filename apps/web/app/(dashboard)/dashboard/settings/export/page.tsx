import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { ExportForm } from './export-form'

export default async function ExportSettingsPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings')

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <p className="text-muted-foreground">{t('export.description')}</p>

      <ExportForm storeSlug={store.slug} />
    </div>
  )
}
