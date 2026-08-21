import { Card, CardContent, Skeleton } from "@louez/ui";

const PurchaseInvoicesLoading = () => (
  <div className="mx-auto max-w-6xl space-y-6">
    <div className="space-y-1">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
    </div>

    <Card>
      <CardContent className="p-0">
        <div className="border-b p-4">
          <div className="grid grid-cols-6 gap-4">
            {["seller", "number", "issueDate", "total", "status", "action"].map((column) => (
              <Skeleton key={column} className="h-4 w-20" />
            ))}
          </div>
        </div>
        {["row-1", "row-2", "row-3", "row-4", "row-5"].map((row) => (
          <div key={row} className="border-b p-4 last:border-0">
            <div className="grid grid-cols-6 gap-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-20" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  </div>
);

export default PurchaseInvoicesLoading;
