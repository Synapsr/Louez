import { db } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { customers, reservations } from '@louez/db'
import { eq, and, desc } from 'drizzle-orm'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { getTranslations } from 'next-intl/server'
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Pencil,
  CreditCard,
  Building2,
} from 'lucide-react'

import { Button } from '@louez/ui'
import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui'
import { Badge } from '@louez/ui'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@louez/ui'
import { formatCurrency } from '@louez/utils'
import { CustomerNotes } from './customer-notes'

interface CustomerPageProps {
  params: Promise<{ id: string }>
}

const statusVariants: Record<string, 'default' | 'secondary' | 'error' | 'outline'> = {
  pending: 'outline',
  confirmed: 'default',
  ongoing: 'default',
  completed: 'secondary',
  cancelled: 'error',
  rejected: 'error',
}

export default async function CustomerPage({ params }: CustomerPageProps) {
  const t = await getTranslations('dashboard.customers')
  const tReservations = await getTranslations('dashboard.reservations')
  const tCommon = await getTranslations('common')
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

  // Get customer reservations with items
  const customerReservations = await db.query.reservations.findMany({
    where: eq(reservations.customerId, customer.id),
    with: {
      items: {
        with: {
          product: true,
        },
      },
    },
    orderBy: [desc(reservations.createdAt)],
  })

  // Calculate stats
  const stats = {
    totalReservations: customerReservations.length,
    completedReservations: customerReservations.filter(r => r.status === 'completed').length,
    totalSpent: customerReservations
      .filter(r => r.status === 'completed' || r.status === 'ongoing')
      .reduce((sum, r) => sum + parseFloat(r.totalAmount), 0),
    avgOrderValue: customerReservations.length > 0
      ? customerReservations.reduce((sum, r) => sum + parseFloat(r.totalAmount), 0) / customerReservations.length
      : 0,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" render={<Link href="/dashboard/customers" />}>
              <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="space-y-1">
            {customer.customerType === 'business' && customer.companyName ? (
              <>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    {customer.companyName}
                  </h1>
                  <Badge variant="secondary" className="font-normal">
                    {t('customerType.business')}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('contact')}: {customer.firstName} {customer.lastName} · {t('customerSince')} {format(customer.createdAt, 'dd MMMM yyyy', { locale: fr })}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight">
                    {customer.firstName} {customer.lastName}
                  </h1>
                  <Badge variant="outline" className="font-normal">
                    {t('customerType.individual')}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('customerSince')} {format(customer.createdAt, 'dd MMMM yyyy', { locale: fr })}
                </p>
              </>
            )}
          </div>
        </div>
        <Button render={<Link href={`/dashboard/customers/${customer.id}/edit`} />}>
            <Pencil className="mr-2 h-4 w-4" />
            {tCommon('edit')}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('totalReservations')}</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalReservations}</div>
            <p className="text-xs text-muted-foreground">
              {t('completedCount', { count: stats.completedReservations })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('totalSpent')}</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.totalSpent)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('averageOrder')}</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.avgOrderValue)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('completionRate')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.totalReservations > 0
                ? Math.round((stats.completedReservations / stats.totalReservations) * 100)
                : 0}%
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Contact Info */}
        <Card>
          <CardHeader>
            <CardTitle>{t('contact')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <a href={`mailto:${customer.email}`} className="hover:underline">
                {customer.email}
              </a>
            </div>
            {customer.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <a href={`tel:${customer.phone}`} className="hover:underline">
                  {customer.phone}
                </a>
              </div>
            )}
            {(customer.address || customer.city || customer.postalCode) && (
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  {customer.address && <div>{customer.address}</div>}
                  {(customer.postalCode || customer.city) && (
                    <div>
                      {customer.postalCode} {customer.city}
                    </div>
                  )}
                  {customer.country && customer.country !== 'FR' && (
                    <div className="text-muted-foreground">{customer.country}</div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('notes.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerNotes customerId={customer.id} initialNotes={customer.notes || ''} />
          </CardContent>
        </Card>
      </div>

      {/* Reservations */}
      <Card>
        <CardHeader>
          <CardTitle>{t('reservationHistory')}</CardTitle>
        </CardHeader>
        <CardContent>
          {customerReservations.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {t('noReservationsForCustomer')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tReservations('number')}</TableHead>
                  <TableHead>{tReservations('period')}</TableHead>
                  <TableHead>{t('products')}</TableHead>
                  <TableHead>{tCommon('status')}</TableHead>
                  <TableHead className="text-right">{t('amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customerReservations.map((reservation) => (
                  <TableRow key={reservation.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/reservations/${reservation.id}`}
                        className="font-medium hover:underline"
                      >
                        #{reservation.number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {format(reservation.startDate, 'dd/MM/yyyy', { locale: fr })}
                        {' - '}
                        {format(reservation.endDate, 'dd/MM/yyyy', { locale: fr })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {reservation.items.map((item, idx) => (
                          <span key={item.id}>
                            {idx > 0 && ', '}
                            {item.product?.name || t('deletedProduct')}
                            {item.quantity > 1 && ` (x${item.quantity})`}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariants[reservation.status]}>
                        {tReservations(`status.${reservation.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(parseFloat(reservation.totalAmount))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
