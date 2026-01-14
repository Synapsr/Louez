import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { customers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Button } from '@/components/ui/button'
import { CustomerForm } from '../../customer-form'

interface EditCustomerPageProps {
  params: Promise<{ id: string }>
}

export default async function EditCustomerPage({ params }: EditCustomerPageProps) {
  const t = await getTranslations('dashboard.customers')
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const { id } = await params

  const customer = await db.query.customers.findFirst({
    where: and(
      eq(customers.id, id),
      eq(customers.storeId, store.id)
    ),
  })

  if (!customer) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/dashboard/customers/${customer.id}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('editCustomer')} - {customer.firstName} {customer.lastName}
          </h1>
          <p className="text-muted-foreground">
            {t('editCustomerDescription')}
          </p>
        </div>
      </div>

      <CustomerForm customer={customer} />
    </div>
  )
}
