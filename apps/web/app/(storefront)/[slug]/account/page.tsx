import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { db } from '@louez/db'
import { stores, reservations } from '@louez/db'
import { eq, and, desc } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import {
  User,
  Calendar,
  Package,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  Sparkles,
  CreditCard,
  History,
} from 'lucide-react'

import { Card, CardContent } from '@louez/ui'
import { Badge } from '@louez/ui'
import { formatCurrency } from '@louez/utils'
import type { StoreSettings, StoreTheme } from '@louez/types'
import { getCustomerSession } from './actions'
import { generateStoreMetadata } from '@/lib/seo'
import { getStorefrontUrl, storefrontRedirect } from '@/lib/storefront-url'
import { LogoutButton } from '@/components/storefront/logout-button'
import { PageTracker } from '@/components/storefront/page-tracker'
import { SuccessToast } from './success-toast'
import { formatStoreDate } from '@/lib/utils/store-date'

interface AccountPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: AccountPageProps): Promise<Metadata> {
  const { slug } = await params

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    return { title: 'Boutique introuvable' }
  }

  return generateStoreMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      settings: store.settings as StoreSettings,
      theme: store.theme as StoreTheme,
    },
    {
      title: `Mon compte - ${store.name}`,
      description: `Gérez vos réservations et votre compte chez ${store.name}.`,
      noIndex: true,
    }
  )
}

export default async function AccountPage({ params }: AccountPageProps) {
  const { slug } = await params
  const t = await getTranslations('storefront.account')

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    notFound()
  }

  const storeSettings = (store.settings as StoreSettings) || {}
  const currency = storeSettings.currency || 'EUR'
  const storeTimezone = storeSettings.timezone

  const session = await getCustomerSession(slug)

  if (!session) {
    storefrontRedirect(slug, '/account/login')
  }

  type ReservationStatus = 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'

  const statusConfig: Record<ReservationStatus, {
    label: string
    variant: 'secondary' | 'default' | 'outline' | 'error'
    icon: typeof Clock
    color: string
    bgColor: string
  }> = {
    pending: {
      label: t('status.pending'),
      variant: 'secondary',
      icon: Clock,
      color: 'text-amber-600 dark:text-amber-400',
      bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    },
    confirmed: {
      label: t('status.confirmed'),
      variant: 'default',
      icon: CheckCircle,
      color: 'text-emerald-600 dark:text-emerald-400',
      bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    },
    ongoing: {
      label: t('status.ongoing'),
      variant: 'default',
      icon: Package,
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    },
    completed: {
      label: t('status.completed'),
      variant: 'outline',
      icon: CheckCircle,
      color: 'text-gray-500',
      bgColor: 'bg-gray-50 dark:bg-gray-950/30',
    },
    cancelled: {
      label: t('status.cancelled'),
      variant: 'error',
      icon: XCircle,
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-50 dark:bg-red-950/30',
    },
    rejected: {
      label: t('status.rejected'),
      variant: 'error',
      icon: XCircle,
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-50 dark:bg-red-950/30',
    },
  }

  const customerReservations = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, store.id),
      eq(reservations.customerId, session.customerId)
    ),
    orderBy: [desc(reservations.createdAt)],
    with: {
      items: true,
      payments: true,
    },
  })

  // Current reservations: pending, confirmed, ongoing (active)
  const currentReservations = customerReservations.filter(
    (r) => r.status === 'pending' || r.status === 'confirmed' || r.status === 'ongoing'
  )

  // History: completed, cancelled, rejected (closed)
  const historyReservations = customerReservations.filter(
    (r) => r.status === 'completed' || r.status === 'cancelled' || r.status === 'rejected'
  )

  const pendingReservations = customerReservations.filter(
    (r) => r.status === 'pending'
  )

  const activeReservations = customerReservations.filter(
    (r) => r.status === 'confirmed' || r.status === 'ongoing'
  )

  // Get initials for avatar
  const initials = `${session.customer.firstName?.[0] || ''}${session.customer.lastName?.[0] || ''}`.toUpperCase()

  return (
    <>
      <PageTracker page="account" />
      <SuccessToast />
      <div className="min-h-[calc(100vh-200px)] bg-gradient-to-b from-muted/30 to-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Profile Header */}
        <Card className="mb-8 overflow-hidden border-0 shadow-sm">
          <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent">
            <div className="p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-semibold shadow-lg">
                    {initials || <User className="h-7 w-7" />}
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold">
                      {session.customer.firstName} {session.customer.lastName}
                    </h1>
                    <p className="text-muted-foreground">{session.customer.email}</p>
                  </div>
                </div>
                <LogoutButton storeSlug={slug} />
              </div>
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-3 divide-x border-t bg-background/50 backdrop-blur-sm">
              <div className="py-4 px-6 text-center">
                <p className="text-2xl font-bold text-primary">{customerReservations.length}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('reservations')}</p>
              </div>
              <div className="py-4 px-6 text-center">
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{activeReservations.length}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('activeReservations')}</p>
              </div>
              <div className="py-4 px-6 text-center">
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{pendingReservations.length}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('pending')}</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Current Reservations (pending, confirmed, ongoing) */}
        {currentReservations.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <h2 className="text-lg font-semibold">{t('activeReservationsTitle')}</h2>
            </div>
            <div className="space-y-3">
              {currentReservations.map((reservation) => {
                const config = statusConfig[reservation.status as ReservationStatus]
                const StatusIcon = config.icon
                const isPaid = reservation.payments.some((p) => p.status === 'completed')
                const isPending = reservation.status === 'pending'

                return (
                  <Link
                    key={reservation.id}
                    href={getStorefrontUrl(slug, `/account/reservations/${reservation.id}`)}
                    className="block"
                  >
                    <Card className={`group hover:shadow-md transition-all duration-200 border-l-4 ${isPending ? 'border-l-amber-400 dark:border-l-amber-600' : 'border-l-primary'}`}>
                      <CardContent className="p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-2 flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-lg">
                                #{reservation.number}
                              </span>
                              <Badge variant={config.variant} className="gap-1">
                                <StatusIcon className="h-3 w-3" />
                                {config.label}
                              </Badge>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1.5">
                                <Calendar className="h-4 w-4 flex-shrink-0" />
                                <span>
                                  {formatStoreDate(reservation.startDate, storeTimezone, 'RANGE_ELEMENT')}
                                  {' → '}
                                  {formatStoreDate(reservation.endDate, storeTimezone, 'RANGE_ELEMENT')}
                                </span>
                              </span>
                              <span className="flex items-center gap-1.5">
                                <Package className="h-4 w-4 flex-shrink-0" />
                                {t('itemCount', { count: reservation.items.length })}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2 flex-shrink-0">
                            <div className="flex items-center gap-3">
                              <span className="font-semibold text-lg">
                                {formatCurrency(parseFloat(reservation.totalAmount), currency)}
                              </span>
                              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-xs ${isPaid ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800' : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800'}`}
                            >
                              <CreditCard className="h-3 w-3 mr-1" />
                              {isPaid ? t('paymentPaid') : t('paymentPending')}
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* Reservations History (completed, cancelled, rejected) */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
              <History className="h-4 w-4 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold">{t('reservationsHistory')}</h2>
          </div>

          {historyReservations.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <div className="flex h-16 w-16 mx-auto mb-4 items-center justify-center rounded-full bg-muted">
                  <Package className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="font-semibold mb-1">{t('noHistory')}</h3>
                <p className="text-muted-foreground">{t('noHistoryDescription')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {historyReservations.map((reservation) => {
                const config = statusConfig[reservation.status as ReservationStatus]
                const StatusIcon = config.icon
                const isPaid = reservation.payments.some((p) => p.status === 'completed')

                return (
                  <Link
                    key={reservation.id}
                    href={getStorefrontUrl(slug, `/account/reservations/${reservation.id}`)}
                    className="block"
                  >
                    <Card className="group hover:shadow-sm transition-all duration-200">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${config.bgColor} flex-shrink-0`}>
                              <StatusIcon className={`h-5 w-5 ${config.color}`} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">#{reservation.number}</span>
                                <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {formatStoreDate(reservation.startDate, storeTimezone, 'dd/MM HH:mm')}
                                {' - '}
                                {formatStoreDate(reservation.endDate, storeTimezone, 'TIMESTAMP')}
                                {' • '}
                                {t('itemCount', { count: reservation.items.length })}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="text-right">
                              <p className="font-medium">
                                {formatCurrency(parseFloat(reservation.totalAmount), currency)}
                              </p>
                              <p className={`text-xs ${isPaid ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                {isPaid ? t('paymentPaid') : t('paymentPending')}
                              </p>
                            </div>
                            <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
    </>
  )
}
