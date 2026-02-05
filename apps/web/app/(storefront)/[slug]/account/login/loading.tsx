import { Skeleton } from '@louez/ui'
import { Card, CardContent } from '@louez/ui'

export default function LoginLoading() {
  return (
    <div className="min-h-[calc(100vh-200px)] bg-gradient-to-b from-muted/30 to-background">
      <div className="container mx-auto px-4 py-8">
        {/* Back Button */}
        <div className="mb-8">
          <Skeleton className="h-9 w-24" />
        </div>

        <div className="max-w-md mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <Skeleton className="h-16 w-16 rounded-full mx-auto mb-4" />
            <Skeleton className="h-7 w-48 mx-auto mb-2" />
            <Skeleton className="h-5 w-64 mx-auto" />
          </div>

          {/* Login Form */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              {/* Email field */}
              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-10 w-full" />
              </div>

              {/* Description */}
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />

              {/* Submit button */}
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>

          {/* Security Note */}
          <Skeleton className="h-3 w-48 mx-auto mt-6" />
        </div>
      </div>
    </div>
  )
}
