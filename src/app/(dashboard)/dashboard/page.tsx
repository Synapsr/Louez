import { Suspense } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { reservations, products, customers } from '@/lib/db/schema'
import { eq, and, gte, lte, sql, count, desc } from 'drizzle-orm'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CalendarDays,
  Package,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Euro,
  Clock,
  AlertCircle,
  CheckCircle,
  Plus,
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

async function getStats(storeId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  // Get first day of current month
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  // Get today's departures (confirmed reservations starting today)
  const todaysDepartures = await db
    .select({ count: count() })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(reservations.status, 'confirmed'),
        gte(reservations.startDate, today),
        lte(reservations.startDate, tomorrow)
      )
    )

  // Get today's returns (ongoing reservations ending today)
  const todaysReturns = await db
    .select({ count: count() })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(reservations.status, 'ongoing'),
        gte(reservations.endDate, today),
        lte(reservations.endDate, tomorrow)
      )
    )

  // Get pending reservations
  const pendingReservations = await db
    .select({ count: count() })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(reservations.status, 'pending')
      )
    )

  // Get monthly revenue (completed reservations this month)
  const monthlyRevenue = await db
    .select({ total: sql<string>`COALESCE(SUM(${reservations.totalAmount}), 0)` })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(reservations.status, 'completed'),
        gte(reservations.createdAt, firstDayOfMonth)
      )
    )

  return {
    todaysDepartures: todaysDepartures[0]?.count || 0,
    todaysReturns: todaysReturns[0]?.count || 0,
    pendingReservations: pendingReservations[0]?.count || 0,
    monthlyRevenue: parseFloat(monthlyRevenue[0]?.total || '0'),
  }
}

async function getTodaysDeparturesList(storeId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, 'confirmed'),
      gte(reservations.startDate, today),
      lte(reservations.startDate, tomorrow)
    ),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
    },
    orderBy: [reservations.startDate],
    limit: 5,
  })
}

async function getTodaysReturnsList(storeId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, 'ongoing'),
      gte(reservations.endDate, today),
      lte(reservations.endDate, tomorrow)
    ),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
    },
    orderBy: [reservations.endDate],
    limit: 5,
  })
}

async function getPendingReservationsList(storeId: string) {
  return db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, 'pending')
    ),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
    },
    orderBy: [desc(reservations.createdAt)],
    limit: 5,
  })
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-4" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-16" />
      </CardContent>
    </Card>
  )
}

async function StatCards({ storeId }: { storeId: string }) {
  const stats = await getStats(storeId)
  const t = await getTranslations('dashboard.home')

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('todaysDepartures')}
          </CardTitle>
          <ArrowUpRight className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.todaysDepartures}</div>
          <p className="text-xs text-muted-foreground">{t('toDeliver')}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('todaysReturns')}
          </CardTitle>
          <ArrowDownRight className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.todaysReturns}</div>
          <p className="text-xs text-muted-foreground">{t('toRecover')}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('pendingRequests')}
          </CardTitle>
          <Clock className="h-4 w-4 text-orange-500" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold">{stats.pendingReservations}</span>
            {stats.pendingReservations > 0 && (
              <Badge variant="secondary" className="bg-orange-100 text-orange-700">
                {t('toProcess')}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('monthlyRevenue')}
          </CardTitle>
          <Euro className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(stats.monthlyRevenue)}</div>
          <p className="text-xs text-muted-foreground">
            {format(new Date(), 'MMMM yyyy', { locale: fr })}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

async function TodaysDepartures({ storeId }: { storeId: string }) {
  const departures = await getTodaysDeparturesList(storeId)
  const t = await getTranslations('dashboard.home')
  const tRes = await getTranslations('dashboard.reservations')

  if (departures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <CheckCircle className="h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">
          {t('noDeparturesDescription')}
        </p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{tRes('number')}</TableHead>
          <TableHead>{tRes('customer')}</TableHead>
          <TableHead>{t('products')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {departures.map((reservation) => (
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
              {reservation.customer.firstName} {reservation.customer.lastName}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {reservation.items.map((item, idx) => (
                <span key={item.id}>
                  {idx > 0 && ', '}
                  {item.product?.name}
                </span>
              ))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

async function TodaysReturns({ storeId }: { storeId: string }) {
  const returns = await getTodaysReturnsList(storeId)
  const t = await getTranslations('dashboard.home')
  const tRes = await getTranslations('dashboard.reservations')

  if (returns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <CheckCircle className="h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">
          {t('noReturnsDescription')}
        </p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{tRes('number')}</TableHead>
          <TableHead>{tRes('customer')}</TableHead>
          <TableHead>{t('products')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {returns.map((reservation) => (
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
              {reservation.customer.firstName} {reservation.customer.lastName}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {reservation.items.map((item, idx) => (
                <span key={item.id}>
                  {idx > 0 && ', '}
                  {item.product?.name}
                </span>
              ))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

async function PendingRequests({ storeId }: { storeId: string }) {
  const pending = await getPendingReservationsList(storeId)
  const t = await getTranslations('dashboard.home')
  const tRes = await getTranslations('dashboard.reservations')

  if (pending.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <CheckCircle className="h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">
          {t('noPendingRequests')}
        </p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{tRes('number')}</TableHead>
          <TableHead>{tRes('customer')}</TableHead>
          <TableHead>{tRes('period')}</TableHead>
          <TableHead className="text-right">{tRes('total')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pending.map((reservation) => (
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
              {reservation.customer.firstName} {reservation.customer.lastName}
            </TableCell>
            <TableCell className="text-sm">
              {format(reservation.startDate, 'dd/MM', { locale: fr })} - {format(reservation.endDate, 'dd/MM', { locale: fr })}
            </TableCell>
            <TableCell className="text-right font-medium">
              {formatCurrency(parseFloat(reservation.totalAmount))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  )
}

export default async function DashboardHomePage() {
  const store = await getCurrentStore()
  if (!store) return null

  const session = await auth()

  const t = await getTranslations('dashboard.home')
  const tProducts = await getTranslations('dashboard.products')
  const tReservations = await getTranslations('dashboard.reservations')

  const firstName = session?.user?.name?.split(' ')[0] || ''

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('greeting', { name: firstName })}
          </h1>
          <p className="text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/reservations/new">
            <Plus className="mr-2 h-4 w-4" />
            {tReservations('addReservation')}
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <Suspense
        fallback={
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
        }
      >
        <StatCards storeId={store.id} />
      </Suspense>

      {/* Today's Activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ArrowUpRight className="h-5 w-5 text-green-500" />
                {t('todaysDepartures')}
              </CardTitle>
              <CardDescription>
                {t('departuresDescription')}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/reservations?status=confirmed">
                {t('viewAll')}
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<ListSkeleton />}>
              <TodaysDepartures storeId={store.id} />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ArrowDownRight className="h-5 w-5 text-blue-500" />
                {t('todaysReturns')}
              </CardTitle>
              <CardDescription>
                {t('returnsDescription')}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/reservations?status=ongoing">
                {t('viewAll')}
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<ListSkeleton />}>
              <TodaysReturns storeId={store.id} />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      {/* Pending Requests */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-500" />
              {t('pendingRequests')}
            </CardTitle>
            <CardDescription>
              {t('pendingDescription')}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/reservations?status=pending">
              {t('viewAll')}
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<ListSkeleton />}>
            <PendingRequests storeId={store.id} />
          </Suspense>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('quickActions')}</CardTitle>
            <CardDescription>
              {t('quickActionsDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Link
              href="/dashboard/products/new"
              className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted transition-colors"
            >
              <Package className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">{tProducts('addProduct')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('addProductDescription')}
                </p>
              </div>
            </Link>
            <Link
              href="/dashboard/reservations/new"
              className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted transition-colors"
            >
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">{tReservations('addReservation')}</p>
                <p className="text-sm text-muted-foreground">
                  {tReservations('createManually')}
                </p>
              </div>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('yourStore')}</CardTitle>
            <CardDescription>
              {t('yourStoreDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
              <span className="text-sm font-medium truncate flex-1">
                {store.slug}.{process.env.NEXT_PUBLIC_APP_DOMAIN || 'louez.io'}
              </span>
              <a
                href={`https://${store.slug}.${process.env.NEXT_PUBLIC_APP_DOMAIN || 'louez.io'}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-sm font-medium text-primary hover:underline"
              >
                {t('visit')}
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
