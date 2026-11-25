import type { Metadata } from "next";
import { Suspense } from "react";

import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

// The page reads the partner's space on every request.
export const instant = false;

// Its URL holds a secret: no other site learns it from a Referer.
export const metadata: Metadata = { referrer: "no-referrer" };

/** A partner's space wears its store's look: the page draws it, from the store it reads. */
const PartnerSpaceLayout = async ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider messages={await getMessages()}>
    <Suspense>{children}</Suspense>
  </NextIntlClientProvider>
);

export default PartnerSpaceLayout;
