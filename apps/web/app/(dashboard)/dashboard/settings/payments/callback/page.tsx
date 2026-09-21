import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getCurrentStore, hasPermission } from '@/lib/store-context'
import { getAccountStatus } from '@/lib/stripe'
import { db } from '@louez/db'
import { stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui'
import { Button } from '@louez/ui'
import { CheckCircleIcon, WarningIcon } from '@louez/ui/icons'
import Link from 'next/link'

import { DashboardBreadcrumbLabel } from '@/components/dashboard/dashboard-breadcrumbs-context'

import { sanitizeStripeNextPath } from '../stripe-return'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function StripeCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  if (!hasPermission(store.role, 'manage_settings')) {
    redirect('/dashboard/settings/payments')
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
    <>
      <DashboardBreadcrumbLabel
        label={
          isActive
            ? t('callback.successTitle')
            : t('callback.incompleteTitle')
        }
      />
      <div className="flex min-h-[50vh] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2">
              {isActive ? (
                <CheckCircleIcon className="h-5 w-5 shrink-0 text-green-500" />
              ) : (
                <WarningIcon className="h-5 w-5 shrink-0 text-yellow-500" />
              )}
              {isActive
                ? t('callback.successTitle')
                : t('callback.incompleteTitle')}
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
    </>
  )
}
