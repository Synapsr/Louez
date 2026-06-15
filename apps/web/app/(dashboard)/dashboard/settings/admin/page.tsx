import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { isCurrentUserPlatformAdmin } from '@/lib/platform-admin'
import { getStoreBilling } from '@/lib/pay-as-you-go'
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

  const billing = await getStoreBilling(store.id)

  return (
    <div className="mx-auto max-w-4xl space-y-4 sm:space-y-6">
      <p className="text-sm sm:text-base text-muted-foreground">
        {t('admin.description')}
      </p>

      <AdminSettingsForm
        trialDays={store.trialDays ?? 0}
        discountPercent={store.discountPercent ?? 0}
        discountDurationMonths={store.discountDurationMonths ?? 0}
        billingMode={billing.billingMode}
        flatRateCents={billing.config.flatRateCents}
        tiers={billing.config.tiers}
        currency={billing.config.currency}
      />
    </div>
  )
}
