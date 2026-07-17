import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { CheckCircle2, AlertCircle } from 'lucide-react'

import { getCurrentStore } from '@/lib/store-context'
import { getAccountStatus } from '@/lib/stripe'
import { db } from '@louez/db'
import { stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui'
import { Button } from '@louez/ui'
import Link from 'next/link'

import { sanitizeStripeNextPath } from '../stripe-return'

export default async function StripeCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  // Where the flow that launched the KYC wants the user back (e.g. the
  // onboarding source step). Allowlisted; null for the regular settings flow.
  const next = sanitizeStripeNextPath((await searchParams).next)

  const t = await getTranslations('dashboard.settings.payments')

  // If no Stripe account, redirect back
  if (!store.stripeAccountId) {
    redirect(next ? '/onboarding/stripe' : '/dashboard/settings/payments')
  }

  // Get latest status from Stripe
  let status
  try {
    status = await getAccountStatus(store.stripeAccountId)
  } catch {
    // Status unknown: don't move the onboarding flow forward blindly
    redirect(next ? '/onboarding/stripe' : '/dashboard/settings/payments')
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

  // Status synced — resume the interrupted flow without the settings screen.
  // Stripe also sends users here when they bail out of the KYC ("Return to
  // Louez"): only move the flow forward once the form was actually submitted;
  // otherwise land back on the reservation-mode step so they can re-choose.
  if (next) {
    redirect(status.detailsSubmitted ? next : '/onboarding/stripe')
  }

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
