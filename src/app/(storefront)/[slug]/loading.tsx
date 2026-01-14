import { Skeleton } from '@/components/ui/skeleton'

export default function StoreLoading() {
  return (
    <div className="space-y-12 py-8">
      {/* Hero */}
      <div className="container mx-auto px-4 text-center">
        <Skeleton className="mx-auto h-12 w-64 mb-4" />
        <Skeleton className="mx-auto h-6 w-96 mb-8" />
        <Skeleton className="mx-auto h-12 w-40" />
      </div>

      {/* Categories */}
      <div className="container mx-auto px-4">
        <Skeleton className="h-8 w-40 mb-6" />
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-lg" />
          ))}
        </div>
      </div>

      {/* Featured Products */}
      <div className="container mx-auto px-4">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="aspect-square rounded-lg" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
