import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { isCurrentUserPlatformAdmin } from '@/lib/platform-admin'
import { AdminSettingsForm } from './admin-settings-form'

export default async function AdminSettingsPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const isAdmin = await isCurrentUserPlatformAdmin()
  if (!isAdmin) {
    redirect('/dashboard/settings')
  }

  const t = await getTranslations('dashboard.settings')

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <p className="text-muted-foreground">
        {t('admin.description')}
      </p>

      <AdminSettingsForm trialDays={store.trialDays ?? 0} />
    </div>
  )
}
