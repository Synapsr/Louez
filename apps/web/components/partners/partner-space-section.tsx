import type { ReactNode } from "react";

import { Card, CardPanel } from "@louez/ui";

/** A titled block of the partner's space. */
export const PartnerSpaceSection = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) => (
  <section className="space-y-3">
    <div>
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="text-muted-foreground text-sm">{description}</p>}
    </div>
    <Card>
      <CardPanel className="p-4 sm:p-5">{children}</CardPanel>
    </Card>
  </section>
);
