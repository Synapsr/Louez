import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { getCurrentStore } from '@/lib/store-context'
import { Button } from '@/components/ui/button'
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
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/customers">
            <ArrowLeft className="h-4 w-4" />
          </Link>
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
