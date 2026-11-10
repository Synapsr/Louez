import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { getSmsQuotaStatus } from '@/lib/plan-limits'
import { SmsContent } from './sms-content'
import { getSmsLogs, getSmsMonthStats, getAvailableMonths, getTopupHistory } from './actions'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function SmsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; topup?: string }>
}) {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const params = await searchParams

  // Get selected month from URL or default to current month
  const now = new Date()
  const selectedYear = params.year ? parseInt(params.year, 10) : now.getFullYear()
  const selectedMonth = params.month ? parseInt(params.month, 10) : now.getMonth()

  // Check if viewing current month (for quota display)
  const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth()

  // Check for top-up success/cancelled from URL
  const topupSuccess = params.topup === 'success'
  const topupCancelled = params.topup === 'cancelled'

  const [quotaStatus, smsLogs, monthStats, availableMonths, topupHistory] =
    await Promise.all([
      getSmsQuotaStatus(store.id),
      getSmsLogs(store.id, selectedYear, selectedMonth),
      getSmsMonthStats(store.id, selectedYear, selectedMonth),
      getAvailableMonths(store.id),
      getTopupHistory(store.id),
    ])

  return (
    <div className="space-y-6">
      <SmsContent
        quotaStatus={quotaStatus}
        smsLogs={smsLogs}
        monthStats={monthStats}
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        isCurrentMonth={isCurrentMonth}
        availableMonths={availableMonths}
        topupHistory={topupHistory}
        topupSuccess={topupSuccess}
        topupCancelled={topupCancelled}
      />
    </div>
  )
}
