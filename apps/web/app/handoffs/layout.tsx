import { Suspense } from "react";

import { Logo } from "@louez/ui";

// The pages read the session and the handoff on every request.
export const instant = false;

const HandoffLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="dashboard bg-background min-h-screen px-4 py-8 sm:py-12">
    <div className="mx-auto w-full max-w-md space-y-6">
      <Logo className="text-foreground" />
      <Suspense>{children}</Suspense>
    </div>
  </div>
);

export default HandoffLayout;
