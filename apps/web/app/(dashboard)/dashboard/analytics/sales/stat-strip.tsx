import type { ReactNode } from "react";
import { Card, CardPanel } from "@louez/ui";

export const StatStrip = ({ children }: { children: ReactNode }) => {
  return (
    <Card>
      <CardPanel className="grid divide-y p-0 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {children}
      </CardPanel>
    </Card>
  );
};
