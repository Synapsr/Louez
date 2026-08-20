import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@louez/ui";
import { cn } from "@louez/utils";

type InvoicingStepCardProps = {
  badge?: ReactNode;
  children: ReactNode;
  description: string;
  /** Dims the card while its prerequisites are not met. */
  muted?: boolean;
  step: number;
  title: string;
};

/** Numbered card used by the three steps of the electronic-invoicing setup. */
export const InvoicingStepCard = ({
  badge,
  children,
  description,
  muted = false,
  step,
  title,
}: InvoicingStepCardProps) => {
  return (
    <Card className={cn(muted && "opacity-72")}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="bg-muted text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
          >
            {step}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {title}
              {badge}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">{children}</CardContent>
    </Card>
  );
};
