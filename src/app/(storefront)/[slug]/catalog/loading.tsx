import { Skeleton } from '@/components/ui/skeleton'

export default function CatalogueLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar */}
        <div className="w-full lg:w-64 space-y-6">
          <Skeleton className="h-8 w-32" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>

        {/* Products Grid */}
        <div className="flex-1">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-10 w-40" />
          </div>

          {/* Grid */}
          <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="aspect-square rounded-lg" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex justify-between items-center">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-9 w-28" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
