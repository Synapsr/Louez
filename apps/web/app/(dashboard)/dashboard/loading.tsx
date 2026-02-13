import { Loader2 } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

export default async function DashboardLoading() {
  const t = await getTranslations('common')

  return (
    <div className="flex h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      </div>
    </div>
  )
}
