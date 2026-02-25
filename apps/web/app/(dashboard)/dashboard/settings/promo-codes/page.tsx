import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'

import { db } from '@louez/db'
import { promoCodes } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { PromoCodesManager } from './promo-codes-manager'

export default async function PromoCodesSettingsPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings')
  const currency = store.settings?.currency || 'EUR'

  const codes = await db.query.promoCodes.findMany({
    where: eq(promoCodes.storeId, store.id),
    orderBy: (promoCodes, { desc }) => [desc(promoCodes.createdAt)],
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <p className="text-muted-foreground">{t('promoCodes.description')}</p>
      <PromoCodesManager codes={codes} currency={currency} />
    </div>
  )
}
