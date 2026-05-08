import { Skeleton } from '@louez/ui'

import { DashboardActivitySkeleton } from './dashboard-activity-skeleton'
import { DashboardStatsSkeleton } from './dashboard-stats-skeleton'

export const DashboardHomeSkeleton = () => {
  return (
    <div className="relative z-10 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-40" />
      </div>
      <DashboardStatsSkeleton />
      <DashboardActivitySkeleton />
    </div>
  )
}
