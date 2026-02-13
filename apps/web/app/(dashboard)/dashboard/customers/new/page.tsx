import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { getCurrentStore } from '@/lib/store-context'
import { Button } from '@louez/ui'
import { CustomerForm } from '../customer-form'

export default async function NewCustomerPage() {
  const t = await getTranslations('dashboard.customers')
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button render={<Link href="/dashboard/customers" />} variant="ghost" size="icon">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('newCustomer')}</h1>
          <p className="text-muted-foreground">
            {t('newCustomerDescription')}
          </p>
        </div>
      </div>

      <CustomerForm />
    </div>
  )
}
