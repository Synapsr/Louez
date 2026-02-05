import { Skeleton } from '@louez/ui'
import { Card, CardContent, CardHeader } from '@louez/ui'

export default function CalendarLoading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Skeleton className="h-8 w-[180px]" />
          <Skeleton className="mt-2 h-4 w-[280px]" />
        </div>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-9" />
              <Skeleton className="h-9 w-9" />
              <Skeleton className="h-9 w-24" />
              <Skeleton className="ml-2 h-6 w-40" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-[140px]" />
              <Skeleton className="h-9 w-[200px]" />
              <Skeleton className="h-9 w-[120px]" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calendar Grid */}
      <Card>
        <CardContent className="p-0">
          {/* Day Headers */}
          <div className="grid grid-cols-7 border-b">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="p-3 text-center">
                <Skeleton className="mx-auto h-4 w-8" />
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className="grid grid-cols-7">
            {Array.from({ length: 35 }).map((_, i) => (
              <div
                key={i}
                className="min-h-[120px] border-b border-r p-2"
              >
                <Skeleton className="mb-2 h-6 w-6 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-6 w-full rounded" />
                  <Skeleton className="h-6 w-3/4 rounded" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card>
        <CardHeader className="py-3">
          <Skeleton className="h-4 w-20" />
        </CardHeader>
        <CardContent className="py-2">
          <div className="flex flex-wrap gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 rounded" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
