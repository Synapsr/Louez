import { env } from '@/env';
import Script from 'next/script';

/**
 * Umami Analytics component
 *
 * Configure with environment variables:
 * - NEXT_PUBLIC_UMAMI_SCRIPT_URL: Full URL to Umami script (e.g., https://cloud.umami.is/script.js)
 * - NEXT_PUBLIC_UMAMI_WEBSITE_ID: Website ID from Umami dashboard
 *
 * If either is missing, no script is injected.
 *
 * Fetched with CORS, so the browser hands the script's errors to error
 * tracking instead of a bare "Script error.". Umami's script server allows it
 * (`Access-Control-Allow-Origin: *`, cloud and self-hosted); one that does not
 * would have the browser refuse to run it.
 */
export function UmamiAnalytics() {
  const scriptUrl = env.NEXT_PUBLIC_UMAMI_SCRIPT_URL;
  const websiteId = env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

  if (!scriptUrl || !websiteId || process.env.NODE_ENV !== 'production') {
    return null;
  }

  return <Script async src={scriptUrl} crossOrigin="anonymous" data-website-id={websiteId} />;
}
