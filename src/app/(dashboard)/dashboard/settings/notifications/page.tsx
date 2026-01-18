import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { getCurrentStore } from '@/lib/store-context'
import { SettingsNav } from '@/components/dashboard/settings-nav'
import { NotificationsForm } from './notifications-form'
import { getNotificationSettings } from './actions'

export default async function NotificationsPage() {
  const store = await getCurrentStore()
  if (!store) redirect('/onboarding')

  const data = await getNotificationSettings()
  if ('error' in data) redirect('/onboarding')

  const t = await getTranslations('dashboard.settings')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('notifications.title')}</h1>
        <p className="text-muted-foreground">{t('notifications.description')}</p>
      </div>

      <SettingsNav />

      <NotificationsForm
        settings={data.settings}
        discordWebhookUrl={data.discordWebhookUrl}
        ownerPhone={data.ownerPhone}
        smsQuota={data.smsQuota}
      />
    </div>
  )
}
