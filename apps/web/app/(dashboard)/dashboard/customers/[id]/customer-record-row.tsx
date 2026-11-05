import type { ReactNode } from "react";

interface CustomerRecordRowProps {
  label: ReactNode;
  children: ReactNode;
}

/** One fact of the record: its name on the left, its value on the right. */
export const CustomerRecordRow = ({ label, children }: CustomerRecordRowProps) => (
  <div className="flex items-start justify-between gap-4 text-sm">
    <dt className="text-muted-foreground shrink-0">{label}</dt>
    <dd className="min-w-0 text-right">{children}</dd>
  </div>
);
