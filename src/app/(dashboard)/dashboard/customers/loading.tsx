import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export default function CustomersLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-40" />
      </div>

      {/* Search */}
      <div className="flex gap-4">
        <Skeleton className="h-10 w-64" />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b p-4">
            <div className="grid grid-cols-5 gap-4">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="border-b p-4 last:border-0">
              <div className="grid grid-cols-5 gap-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-24" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
