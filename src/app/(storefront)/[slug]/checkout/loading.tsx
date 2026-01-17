import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export default function CheckoutLoading() {
  return (
    <div className="container mx-auto px-4 py-6 md:py-8">
      {/* Back button */}
      <Skeleton className="h-9 w-24 mb-6" />

      {/* Title */}
      <div className="text-center mb-8">
        <Skeleton className="h-8 md:h-9 w-64 mx-auto mb-2" />
        <Skeleton className="h-5 w-48 mx-auto" />
      </div>

      <div className="max-w-4xl mx-auto">
        {/* Stepper */}
        <div className="mb-8">
          <div className="flex items-center justify-center">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex items-center">
                <div className="flex items-center gap-2 px-4 py-2">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="hidden sm:block h-5 w-20" />
                </div>
                {index < 2 && (
                  <Skeleton className="h-5 w-5 mx-2" />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* Form */}
          <div className="lg:col-span-3">
            <Card>
              <CardContent className="pt-6 space-y-4">
                {/* Step header */}
                <div className="mb-4">
                  <Skeleton className="h-6 w-40 mb-2" />
                  <Skeleton className="h-4 w-64" />
                </div>

                {/* Form fields */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-10 w-full" />
                </div>

                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-10 w-full" />
                </div>

                {/* Business checkbox */}
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-4 w-48" />
                </div>

                {/* Continue button */}
                <div className="pt-4">
                  <Skeleton className="h-12 w-full" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-2">
            <Card className="sticky top-4">
              <CardContent className="pt-6 space-y-4">
                <Skeleton className="h-6 w-28" />

                {/* Dates */}
                <Skeleton className="h-10 w-full rounded-lg" />

                {/* Items */}
                <div className="space-y-3">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="h-14 w-14 rounded-lg shrink-0" />
                      <div className="flex-1 min-w-0 space-y-1">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                      <Skeleton className="h-5 w-16" />
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Totals */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <Separator />
                  <div className="flex justify-between">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-6 w-20" />
                  </div>
                </div>

                {/* Deposit info */}
                <div className="border-t pt-3 mt-2 space-y-2">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
