import type { ReactNode } from "react";

export const MultiStorePageShell = ({
  title,
  description,
  periodFilter,
  children,
}: {
  title: string;
  description: string;
  periodFilter: ReactNode;
  children: ReactNode;
}) => (
  <div className="space-y-8">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
      {periodFilter}
    </div>
    {children}
  </div>
);
