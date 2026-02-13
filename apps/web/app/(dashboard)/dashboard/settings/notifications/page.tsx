import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { getCurrentStore } from '@/lib/store-context'
import { NotificationsForm } from './notifications-form'
import { getNotificationSettings } from './actions'

export default async function NotificationsPage() {
  const store = await getCurrentStore()
  if (!store) redirect('/onboarding')

  const data = await getNotificationSettings()
  if ('error' in data) redirect('/onboarding')

  const t = await getTranslations('dashboard.settings')

  // Prepare store info for email preview
  const storeInfo = {
    name: store.name,
    logoUrl: store.logoUrl,
    darkLogoUrl: store.darkLogoUrl,
    email: store.email,
    phone: store.phone,
    address: store.address,
    theme: store.theme,
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <p className="text-muted-foreground">{t('notifications.description')}</p>

      <NotificationsForm
        settings={data.settings}
        discordWebhookUrl={data.discordWebhookUrl}
        ownerPhone={data.ownerPhone}
        smsQuota={data.smsQuota}
        customerSettings={data.customerSettings}
        storeLocale={data.storeLocale}
        storeLanguageName={data.storeLanguageName}
        storeInfo={storeInfo}
      />
    </div>
  )
}
