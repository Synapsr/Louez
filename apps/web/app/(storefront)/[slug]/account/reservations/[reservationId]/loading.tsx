import { Skeleton } from '@louez/ui'
import { Card, CardContent, CardHeader } from '@louez/ui'
import { Separator } from '@louez/ui'

export default function ReservationDetailLoading() {
  return (
    <div className="min-h-[calc(100vh-200px)] bg-gradient-to-b from-muted/30 to-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Back Button */}
        <div className="mb-6">
          <Skeleton className="h-9 w-32" />
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <Skeleton className="h-8 sm:h-9 w-48 mb-2" />
            <Skeleton className="h-4 w-36" />
          </div>
          <Skeleton className="h-10 w-40" />
        </div>

        {/* Status Card */}
        <Card className="mb-6 border-l-4 border-l-primary">
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-4 flex-1">
                <Skeleton className="h-12 w-12 rounded-full shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-48" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Rental Period Card */}
        <Card className="mb-6">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5" />
              <Skeleton className="h-5 w-32" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              {/* Start Date */}
              <div className="flex-1 p-4 rounded-xl bg-muted/30 space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-16" />
              </div>

              {/* Arrow */}
              <Skeleton className="hidden sm:block h-5 w-5" />

              {/* End Date */}
              <div className="flex-1 p-4 rounded-xl bg-muted/30 space-y-2">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Items Card */}
        <Card className="mb-6">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-5" />
                <Skeleton className="h-5 w-28" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex gap-4 p-3 rounded-lg bg-muted/30">
                  <Skeleton className="h-20 w-20 rounded-lg shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>

            <Separator className="my-5" />

            {/* Totals */}
            <div className="space-y-3 max-w-xs ml-auto">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Separator />
              <div className="flex justify-between pt-1">
                <Skeleton className="h-6 w-14" />
                <Skeleton className="h-6 w-20" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Payment History Card */}
        <Card className="mb-6">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5" />
              <Skeleton className="h-5 w-40" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-9 w-9 rounded-full" />
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                  <div className="text-right space-y-1">
                    <Skeleton className="h-5 w-16" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Store Contact Card */}
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardContent className="pt-0">
            <Skeleton className="h-4 w-64 mb-4" />
            <div className="flex flex-wrap gap-3">
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-9 w-36" />
            </div>
            <Skeleton className="h-4 w-56 mt-4 pt-4" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
