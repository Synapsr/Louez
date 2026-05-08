import { DashboardHomeSkeleton } from '@/components/dashboard/home/dashboard-home-skeleton'
import { GradientMesh } from '@/components/dashboard/home'

export default function DashboardLoading() {
  return (
    <>
      <GradientMesh />
      <DashboardHomeSkeleton />
    </>
  )
}
