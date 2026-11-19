import type { Metadata } from "next";
import { Suspense } from "react";

import { Logo } from "@louez/ui";

// The page reads the statement on every request.
export const instant = false;

// Its URL holds a secret: no other site learns it from a Referer.
export const metadata: Metadata = { referrer: "no-referrer" };

const PartnerStatementLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="dashboard bg-background min-h-screen px-4 py-8 sm:py-12">
    <div className="mx-auto w-full max-w-lg space-y-6">
      <Suspense>{children}</Suspense>
      <Logo className="text-muted-foreground mx-auto h-5 w-auto" />
    </div>
  </div>
);

export default PartnerStatementLayout;
