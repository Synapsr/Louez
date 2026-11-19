import type { Metadata } from "next";
import { Suspense } from "react";

import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

import { Logo } from "@louez/ui";

// The page reads the partner's space on every request.
export const instant = false;

// Its URL holds a secret: no other site learns it from a Referer.
export const metadata: Metadata = { referrer: "no-referrer" };

const PartnerSpaceLayout = async ({ children }: { children: React.ReactNode }) => {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={messages}>
      <div className="dashboard bg-background min-h-screen px-4 py-8 sm:py-12">
        <div className="mx-auto w-full max-w-2xl space-y-8">
          <Suspense>{children}</Suspense>
          <Logo className="text-muted-foreground mx-auto h-5 w-auto" />
        </div>
      </div>
    </NextIntlClientProvider>
  );
};

export default PartnerSpaceLayout;
