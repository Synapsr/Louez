import { Card, CardContent, CardHeader, Skeleton } from '@louez/ui'

export const DashboardActivitySkeleton = () => {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 2 }, (_, sectionIndex) => (
        <Card key={sectionIndex}>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, rowIndex) => (
                <Skeleton key={rowIndex} className="h-10 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
