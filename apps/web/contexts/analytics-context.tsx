"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Storefront pages the funnel distinguishes. */
export type PageType =
  | "home"
  | "catalog"
  | "product"
  | "cart"
  | "checkout"
  | "confirmation"
  | "account"
  | "rental";
type DeviceType = "mobile" | "tablet" | "desktop";
type SalesChannel = "marketplace";
export type AnalyticsEventType =
  | "product_view"
  | "add_to_cart"
  | "remove_from_cart"
  | "update_quantity"
  | "checkout_started"
  | "checkout_step_viewed"
  | "checkout_submit_failed"
  | "checkout_completed"
  | "checkout_abandoned"
  | "payment_initiated"
  | "payment_completed"
  | "payment_failed"
  | "login_requested"
  | "login_completed";

interface PageViewData {
  page: PageType;
  productId?: string;
  categoryId?: string;
}

interface EventData {
  eventType: AnalyticsEventType;
  metadata?: Record<string, unknown>;
  customerId?: string;
}

interface AnalyticsContextValue {
  trackPageView: (data: PageViewData) => void;
  trackEvent: (data: EventData) => void;
  sessionId: string | null;
}

interface AnalyticsSession {
  sessionId: string;
  device: DeviceType;
}

const AnalyticsContext = createContext<AnalyticsContextValue | undefined>(undefined);

const SESSION_STORAGE_KEY = "louez_analytics_session";
const TRACK_ENDPOINT = "/api/track";

const NOOP_ANALYTICS: AnalyticsContextValue = {
  trackPageView: () => {},
  trackEvent: () => {},
  sessionId: null,
};

const getDeviceType = (): DeviceType => {
  const userAgent = navigator.userAgent.toLowerCase();
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(userAgent)) {
    return "tablet";
  }
  if (/mobile|android|iphone|ipod|blackberry|opera mini|iemobile/i.test(userAgent)) {
    return "mobile";
  }
  return "desktop";
};

/** Per-tab session id, created once and kept in sessionStorage. */
const getOrCreateSessionId = (): string => {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      return stored;
    }
    const sessionId = crypto.randomUUID();
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    return sessionId;
  } catch {
    return crypto.randomUUID();
  }
};

/**
 * Fire-and-forget delivery: `sendBeacon` survives navigation and unload;
 * the fetch fallback keeps `keepalive` for the same reason. Analytics never
 * throws into the page.
 */
const sendTrackingBeacon = (payload: Record<string, unknown>): void => {
  const body = JSON.stringify(payload);

  if (typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon(TRACK_ENDPOINT, new Blob([body], { type: "application/json" }));
    return;
  }

  fetch(TRACK_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
};

interface AnalyticsProviderProps {
  children: ReactNode;
  storeSlug: string;
  channel?: SalesChannel;
  enabled?: boolean;
}

export const AnalyticsProvider = ({
  children,
  storeSlug,
  channel,
  enabled = true,
}: AnalyticsProviderProps) => {
  // Known only in the browser: read once after mount so server and first
  // client render agree on "no session yet".
  const [session, setSession] = useState<AnalyticsSession | null>(null);

  useEffect(() => {
    setSession({ sessionId: getOrCreateSessionId(), device: getDeviceType() });
  }, []);

  const trackPageView = useCallback(
    (data: PageViewData) => {
      if (!enabled || !session) return;

      sendTrackingBeacon({
        type: "page_view",
        storeSlug,
        sessionId: session.sessionId,
        page: data.page,
        productId: data.productId,
        categoryId: data.categoryId,
        referrer: document.referrer.slice(0, 500) || undefined,
        device: session.device,
      });
    },
    [enabled, session, storeSlug],
  );

  const trackEvent = useCallback(
    (data: EventData) => {
      if (!enabled || !session) return;

      sendTrackingBeacon({
        type: "event",
        storeSlug,
        sessionId: session.sessionId,
        customerId: data.customerId,
        eventType: data.eventType,
        metadata: channel ? { ...data.metadata, channel } : data.metadata,
      });
    },
    [channel, enabled, session, storeSlug],
  );

  const value = useMemo<AnalyticsContextValue>(
    () => ({ trackPageView, trackEvent, sessionId: session?.sessionId ?? null }),
    [trackPageView, trackEvent, session],
  );

  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
};

/** No-op outside the storefront tree (dashboard previews) rather than a throw. */
export const useAnalytics = (): AnalyticsContextValue =>
  useContext(AnalyticsContext) ?? NOOP_ANALYTICS;
