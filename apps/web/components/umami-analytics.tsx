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
 */
export function UmamiAnalytics() {
  const scriptUrl = env.NEXT_PUBLIC_UMAMI_SCRIPT_URL;
  const websiteId = env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

  if (!scriptUrl || !websiteId || process.env.NODE_ENV !== 'production') {
    return null;
  }

  return <Script async src={scriptUrl} data-website-id={websiteId} />;
}
