import { getLocale, getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'

import { isCurrentUserPlatformAdmin } from '@/lib/platform-admin'
import {
  getPlatformFinance,
  getRecentPlatformFees,
} from '@/lib/pay-as-you-go'

function formatMoney(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

/** `2026-06` -> a localized month label. */
function formatMonth(billingMonth: string, locale: string): string {
  const [year, month] = billingMonth.split('-').map(Number)
  if (!year || !month) return billingMonth
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

export default async function PlatformFinancePage() {
  // Defense-in-depth: the /admin layout already gates platform-admin access, but the
  // page re-checks so it can never render for a non-admin even if reached directly.
  const isAdmin = await isCurrentUserPlatformAdmin()
  if (!isAdmin) {
    redirect('/dashboard')
  }

  const [t, locale, finance, recent] = await Promise.all([
    getTranslations('dashboard.settings.finance'),
    getLocale(),
    getPlatformFinance(),
    getRecentPlatformFees(50),
  ])

  const { currency } = finance
  const money = (cents: number) => formatMoney(cents, currency, locale)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      {finance.currencies.length > 1 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t('multiCurrencyWarning', {
            currency: currency.toUpperCase(),
            currencies: finance.currencies
              .map((c) => c.toUpperCase())
              .join(', '),
          })}
        </div>
      )}

      {/* Headline KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('kpi.realizedAllTime')}
          value={money(finance.overall.realizedCents)}
          hint={t('kpi.realizedHint')}
        />
        <KpiCard
          label={t('kpi.thisMonth', {
            month: formatMonth(finance.currentMonth, locale),
          })}
          value={money(finance.thisMonth.realizedCents)}
        />
        <KpiCard
          label={t('kpi.pending')}
          value={money(finance.overall.pendingCents)}
          hint={t('kpi.pendingHint')}
        />
        <KpiCard
          label={t('kpi.reversed')}
          value={money(finance.overall.reversedCents)}
          hint={t('kpi.reversedHint')}
        />
      </div>

      {/* Rental counts (all time) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard
          label={t('kpi.paidRentals')}
          value={String(finance.overall.reservationCount)}
          hint={t('kpi.paidRentalsHint')}
        />
        <KpiCard
          label={t('kpi.freeRentals')}
          value={String(finance.overall.freeCount)}
          hint={t('kpi.freeRentalsHint')}
        />
      </div>

      {/* By month */}
      <Card>
        <CardHeader>
          <CardTitle>{t('byMonth.title')}</CardTitle>
          <CardDescription>{t('byMonth.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {finance.byMonth.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 pr-4 font-medium">{t('table.month')}</th>
                    <th className="py-2 pr-4 text-right font-medium">
                      {t('table.rentals')}
                    </th>
                    <th className="py-2 pr-4 text-right font-medium">
                      {t('table.free')}
                    </th>
                    <th className="py-2 pr-4 text-right font-medium">
                      {t('table.realized')}
                    </th>
                    <th className="py-2 text-right font-medium">
                      {t('table.pending')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {finance.byMonth.map((row) => (
                    <tr key={row.billingMonth} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">
                        {formatMonth(row.billingMonth, locale)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {row.reservationCount}
                      </td>
                      <td className="text-muted-foreground py-2 pr-4 text-right tabular-nums">
                        {row.freeCount}
                      </td>
                      <td className="py-2 pr-4 text-right font-medium tabular-nums">
                        {money(row.realizedCents)}
                      </td>
                      <td className="text-muted-foreground py-2 text-right tabular-nums">
                        {money(row.pendingCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* By store */}
      <Card>
        <CardHeader>
          <CardTitle>{t('byStore.title')}</CardTitle>
          <CardDescription>{t('byStore.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {finance.byStore.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 pr-4 font-medium">{t('table.store')}</th>
                    <th className="py-2 pr-4 font-medium">{t('table.mode')}</th>
                    <th className="py-2 pr-4 text-right font-medium">
                      {t('table.rentals')}
                    </th>
                    <th className="py-2 pr-4 text-right font-medium">
                      {t('table.free')}
                    </th>
                    <th className="py-2 pr-4 text-right font-medium">
                      {t('table.realized')}
                    </th>
                    <th className="py-2 text-right font-medium">
                      {t('table.pending')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {finance.byStore.map((row) => (
                    <tr key={row.storeId} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{row.storeName}</td>
                      <td className="text-muted-foreground py-2 pr-4">
                        {t(`mode.${row.billingMode}`)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {row.reservationCount}
                      </td>
                      <td className="text-muted-foreground py-2 pr-4 text-right tabular-nums">
                        {row.freeCount}
                      </td>
                      <td className="py-2 pr-4 text-right font-medium tabular-nums">
                        {money(row.realizedCents)}
                      </td>
                      <td className="text-muted-foreground py-2 text-right tabular-nums">
                        {money(row.pendingCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent ledger entries */}
      <Card>
        <CardHeader>
          <CardTitle>{t('recent.title')}</CardTitle>
          <CardDescription>{t('recent.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 pr-4 text-right font-medium">
                      {t('recent.amount')}
                    </th>
                    <th className="py-2 pr-4 font-medium">{t('recent.source')}</th>
                    <th className="py-2 pr-4 font-medium">{t('recent.status')}</th>
                    <th className="py-2 font-medium">{t('table.month')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatMoney(entry.amountCents, entry.currency, locale)}
                      </td>
                      <td className="text-muted-foreground py-2 pr-4">
                        {t(`source.${entry.source}`)}
                      </td>
                      <td className="text-muted-foreground py-2 pr-4">
                        {t(`status.${entry.status}`)}
                      </td>
                      <td className="text-muted-foreground py-2">
                        {formatMonth(entry.billingMonth, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-muted-foreground text-sm">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </CardContent>
    </Card>
  )
}

