import type { Metadata } from "next";
import { Suspense } from "react";

import { Logo } from "@louez/ui";

// The pages read the session and the handoff on every request.
export const instant = false;

// Their URL holds a secret: no other site learns it from a Referer.
export const metadata: Metadata = { referrer: "no-referrer" };

const HandoffLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="dashboard bg-background min-h-screen px-4 py-8 sm:py-12">
    <div className="mx-auto w-full max-w-md space-y-6">
      <Logo className="text-foreground" />
      <Suspense>{children}</Suspense>
    </div>
  </div>
);

export default HandoffLayout;
