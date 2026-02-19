import { redirect } from 'next/navigation'

export default function StatisticsPage() {
  redirect('/dashboard/analytics?tab=sales')
}
