import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

import { getCurrentStore } from '@/lib/store-context'
import { getAccountStatus } from '@/lib/stripe'
import { db } from '@louez/db'
import { stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui'
import { Button } from '@louez/ui'
import Link from 'next/link'

export default async function StripeCallbackPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings.payments')

  // If no Stripe account, redirect back
  if (!store.stripeAccountId) {
    redirect('/dashboard/settings/payments')
  }

  // Get latest status from Stripe
  let status
  try {
    status = await getAccountStatus(store.stripeAccountId)
  } catch {
    redirect('/dashboard/settings/payments')
  }

  // Update store with latest status
  await db
    .update(stores)
    .set({
      stripeChargesEnabled: status.chargesEnabled,
      stripeOnboardingComplete: status.chargesEnabled && status.detailsSubmitted,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  const isActive = status.chargesEnabled && status.detailsSubmitted

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {isActive ? (
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
          ) : (
            <AlertCircle className="mx-auto h-12 w-12 text-yellow-500" />
          )}
          <CardTitle className="mt-4">
            {isActive ? t('callback.successTitle') : t('callback.incompleteTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-muted-foreground">
            {isActive
              ? t('callback.successDescription')
              : t('callback.incompleteDescription')}
          </p>
          <Button render={<Link href="/dashboard/settings/payments" />} className="w-full">
              {t('callback.backToSettings')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
