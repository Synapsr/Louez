import type { ReactNode } from "react";

export const MultiStoreLayoutView = ({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) => (
  <div className="bg-muted/30 min-h-screen">
    {header}
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
  </div>
);
