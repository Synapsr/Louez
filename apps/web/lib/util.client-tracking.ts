import { isEmbedRequest } from "@/lib/embed/util.embed-request";
import { loadsClientAnalytics } from "@/lib/handoffs/handoff-privacy";

/** What the root layout loads in the browser (docs/analytics/browser-trackers.md). */
export interface ClientTracking {
  /** PostHog, with the browser's errors, and the client log, sent to the app itself. */
  productAnalytics: boolean;
  /** The third-party marketing trackers, all in components/marketing-trackers.tsx. */
  marketingTrackers: boolean;
}

/**
 * A handoff page's URL holds a secret: nothing may read it. A demo's visitor
 * (a landing demo, a demo store of lib/demo) is no business metric. The
 * storefront widget lives on the store's own website, whose visitors never
 * agreed to the instance's marketing trackers, and what those would collect
 * there serves neither the store nor the instance: it keeps PostHog, which
 * reports its errors, and loads no marketing tracker.
 */
export const clientTrackingFor = ({
  headers,
  isPublicDemo,
  inDemoStore,
}: {
  headers: Pick<Headers, "get">;
  isPublicDemo: boolean;
  inDemoStore: boolean;
}): ClientTracking => {
  const productAnalytics = !isPublicDemo && !inDemoStore && loadsClientAnalytics(headers);
  return { productAnalytics, marketingTrackers: productAnalytics && !isEmbedRequest(headers) };
};
