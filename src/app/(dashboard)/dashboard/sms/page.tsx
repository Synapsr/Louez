import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getCurrentStore } from '@/lib/store-context'
import { canSendSms } from '@/lib/plan-limits'
import { SmsContent } from './sms-content'
import { getSmsLogs, getSmsMonthStats, getAvailableMonths } from './actions'

export default async function SmsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>
}) {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.sms')
  const params = await searchParams

  // Get selected month from URL or default to current month
  const now = new Date()
  const selectedYear = params.year ? parseInt(params.year, 10) : now.getFullYear()
  const selectedMonth = params.month ? parseInt(params.month, 10) : now.getMonth()

  // Check if viewing current month (for quota display)
  const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth()

  const [smsStatus, smsLogs, monthStats, availableMonths] = await Promise.all([
    canSendSms(store.id),
    getSmsLogs(store.id, selectedYear, selectedMonth),
    getSmsMonthStats(store.id, selectedYear, selectedMonth),
    getAvailableMonths(store.id),
  ])

  return (
    <div className="space-y-6">
      <SmsContent
        smsStatus={smsStatus}
        smsLogs={smsLogs}
        monthStats={monthStats}
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        isCurrentMonth={isCurrentMonth}
        availableMonths={availableMonths}
      />
    </div>
  )
}
