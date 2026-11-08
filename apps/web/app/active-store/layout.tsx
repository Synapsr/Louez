import { Suspense } from "react";

import { Logo } from "@louez/ui";

// The page reads the session and the active-store cookie on every request.
export const instant = false;

const ActiveStoreLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="dashboard bg-background min-h-screen px-4 py-8 sm:py-12">
    <div className="mx-auto w-full max-w-md space-y-6">
      <Logo className="text-foreground" />
      <Suspense>{children}</Suspense>
    </div>
  </div>
);

export default ActiveStoreLayout;
