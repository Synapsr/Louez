import { Skeleton } from '@louez/ui'
import { Card, CardContent } from '@louez/ui'

export default function StoreLoading() {
  return (
    <div className="overflow-hidden -mt-20 md:-mt-24">
      {/* Hero Section - Full screen height */}
      <section className="relative min-h-screen flex items-center justify-center">
        {/* Subtle background */}
        <div className="absolute inset-0 bg-gradient-to-b from-muted/20 to-background" />

        {/* Centered Content */}
        <div className="relative z-10 container mx-auto px-4 py-20">
          <div className="max-w-3xl mx-auto text-center">
            {/* Store name */}
            <Skeleton className="h-12 md:h-14 lg:h-16 w-64 md:w-80 mx-auto mb-4" />

            {/* Status badge */}
            <div className="mb-6 flex justify-center">
              <Skeleton className="h-7 w-24 rounded-full" />
            </div>

            {/* Tagline */}
            <Skeleton className="h-6 w-80 md:w-96 mx-auto mb-6" />

            {/* Reassurance badges */}
            <div className="flex flex-wrap justify-center gap-2 md:gap-3 mb-8">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-36 md:w-40 rounded-full" />
              ))}
            </div>

            {/* Date Picker placeholder */}
            <div className="flex justify-center">
              <Skeleton className="h-40 w-full max-w-2xl rounded-2xl" />
            </div>
          </div>
        </div>
      </section>

      {/* Description Section placeholder */}
      <section className="py-16 md:py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center space-y-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5 mx-auto" />
            <Skeleton className="h-5 w-3/4 mx-auto" />
          </div>
        </div>
      </section>

      {/* Trust Badges Section */}
      <section className="py-12 md:py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col items-center text-center p-6 rounded-2xl bg-background"
              >
                <Skeleton className="h-12 w-12 rounded-xl mb-4" />
                <Skeleton className="h-5 w-32 mb-2" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Products Section */}
      <section className="py-16 md:py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10 md:mb-12">
            <div>
              <Skeleton className="h-9 md:h-10 w-48 md:w-64 mb-3" />
              <Skeleton className="h-5 w-64 md:w-80" />
            </div>
            <Skeleton className="h-10 w-32" />
          </div>

          {/* Products Grid */}
          <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
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
        </div>
      </section>

      {/* Location Section */}
      <section className="py-16 md:py-20">
        <div className="container mx-auto px-4">
          {/* Header */}
          <div className="text-center mb-10 md:mb-12">
            <Skeleton className="h-9 md:h-10 w-48 mx-auto mb-3" />
            <Skeleton className="h-5 w-64 mx-auto" />
          </div>

          {/* Map and Contact Grid */}
          <div className="grid lg:grid-cols-2 gap-8 items-stretch">
            {/* Map placeholder */}
            <Skeleton className="h-[400px] rounded-xl" />

            {/* Contact Info Card */}
            <Card className="p-8">
              <div className="space-y-6">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <Skeleton className="h-12 w-12 rounded-xl shrink-0" />
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-24" />
                      <Skeleton className="h-4 w-40" />
                    </div>
                  </div>
                ))}
                <Skeleton className="h-10 w-full mt-4" />
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Login CTA Section */}
      <section className="py-12 md:py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <Card className="bg-gradient-to-r from-primary/5 via-transparent to-primary/5">
            <CardContent className="p-6 md:p-8">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-64" />
                  </div>
                </div>
                <Skeleton className="h-10 w-40" />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-20 md:py-24 relative overflow-hidden">
        <div className="container relative mx-auto px-4 text-center">
          <Skeleton className="h-8 w-40 mx-auto rounded-full mb-6" />
          <Skeleton className="h-10 md:h-12 w-72 md:w-96 mx-auto mb-6" />
          <Skeleton className="h-5 w-80 mx-auto mb-8" />
          <Skeleton className="h-12 w-48 mx-auto" />
        </div>
      </section>
    </div>
  )
}
