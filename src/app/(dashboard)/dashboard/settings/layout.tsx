import { getTranslations } from 'next-intl/server'

import { SettingsNav } from '@/components/dashboard/settings-nav'
import { isCurrentUserPlatformAdmin } from '@/lib/platform-admin'

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const t = await getTranslations('dashboard.settings')
  const isPlatformAdmin = await isCurrentUserPlatformAdmin()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
      </div>

      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[220px_1fr] xl:gap-10">
        <SettingsNav isPlatformAdmin={isPlatformAdmin} />
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  )
}
