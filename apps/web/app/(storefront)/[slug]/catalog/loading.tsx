import { Skeleton } from '@louez/ui'
import { Card, CardContent } from '@louez/ui'

export default function CatalogLoading() {
  return (
    <div className="min-h-screen">
      {/* Header Section */}
      <section className="bg-muted/30 border-b">
        <div className="container mx-auto px-4 py-6 md:py-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {/* Title and count */}
            <div className="shrink-0">
              <Skeleton className="h-8 md:h-9 w-40 md:w-48 mb-2" />
              <Skeleton className="h-5 w-24" />
            </div>

            {/* Date picker skeleton */}
            <Skeleton className="h-12 w-full lg:w-80 rounded-lg" />
          </div>

          {/* Category Pills */}
          <div className="flex items-center gap-2 mt-6 overflow-x-auto pb-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton
                key={i}
                className={`shrink-0 h-9 rounded-full ${i === 0 ? 'w-28' : 'w-24'}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Products Grid Section */}
      <section className="container mx-auto px-4 py-8 md:py-10">
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <Skeleton className="aspect-square w-full" />
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <div className="flex items-baseline gap-2">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-4 w-12" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
