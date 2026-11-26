import Script from "next/script";

import { UmamiAnalytics } from "@/components/umami-analytics";
import { env } from "@/env";

/**
 * Every third-party marketing tracker of the instance, and nowhere else: the
 * root layout renders them where `clientTrackingFor` allows
 * (lib/util.client-tracking.ts), never in the storefront widget. A new tracker
 * or ad pixel goes here (docs/analytics/browser-trackers.md).
 */
export const MarketingTrackers = () => (
  <>
    <UmamiAnalytics />

    {env.NEXT_PUBLIC_FROMHELLO_KEY &&
      env.NEXT_PUBLIC_FROMHELLO_API_URL && (
        // Fetched with CORS, which its server allows, so the browser hands its
        // errors to error tracking instead of a bare "Script error.".
        <Script
          src={`${env.NEXT_PUBLIC_FROMHELLO_API_URL.replace(/\/$/, "")}/api/t.js`}
          crossOrigin="anonymous"
          data-key={env.NEXT_PUBLIC_FROMHELLO_KEY}
          data-cookie-domain={env.NEXT_PUBLIC_FROMHELLO_COOKIE_DOMAIN || undefined}
          strategy="afterInteractive"
        />
      )}
  </>
);
