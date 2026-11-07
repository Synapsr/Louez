import Script from "next/script";

import { env } from "@/env";
import { isBillingEnabled } from "@/lib/billing/mode";
import { referralCookieDomain } from "@/lib/referral/link";

/**
 * The Klibon affiliate tag (lib/acquisition/klibon.ts), on the sign-in, onboarding and
 * dashboard pages only: storefronts belong to the stores, and their visitors are not
 * Louez's prospects. Louez Cloud only, once KLIBON_PROGRAM_ID is set. The cookie domain
 * is the one the store referral cookie uses (`.louez.io`), so the code an affiliate's
 * link left on louez.io is read on app.louez.io.
 */
export const KlibonTag = () => {
  const programId = env.KLIBON_PROGRAM_ID;
  if (!programId || !isBillingEnabled()) return null;

  return (
    <Script
      async
      src={`https://go.klibon.com/klibon.js?p=${programId}`}
      data-cookie-domain={referralCookieDomain()}
    />
  );
};
