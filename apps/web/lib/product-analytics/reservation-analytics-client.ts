"use client";

import posthog from "posthog-js";

import {
  productAnalyticsEvents,
  reservationManagementAnalyticsBaseProperties,
  type ReservationAnalyticsAction,
} from "@/lib/product-analytics/analytics-events";
import {
  resolveReservationAnalyticsSource,
  type ReservationAnalyticsSource,
} from "@/lib/product-analytics/reservation-analytics";

interface ReservationAnalyticsProperties {
  reservationId: string;
  reservationStatus?: string | null;
  source?: ReservationAnalyticsSource;
  properties?: Record<string, string | number | boolean | null | undefined>;
}

interface ReservationActionAnalyticsProperties extends ReservationAnalyticsProperties {
  action: ReservationAnalyticsAction;
}

interface ReservationQuickActionsViewedProperties extends ReservationAnalyticsProperties {
  visibleActions: ReservationAnalyticsAction[];
}

interface StripeRefundRequestedProperties extends ReservationAnalyticsProperties {
  /** The refund's state (`succeeded`, `pending`, `failed`) or the refusal's code. */
  outcome: string;
  /** The whole refundable remainder, or part of it. */
  scope: "full" | "partial";
  reason: "requested_by_customer" | "duplicate";
}

interface ReservationQuickActionClickedProperties
  extends ReservationActionAnalyticsProperties {
  slot: "primary" | "secondary";
}

const getBrowserReservationSource = (): ReservationAnalyticsSource => {
  if (typeof window === "undefined") return "unknown";

  const explicitSource = new URLSearchParams(window.location.search).get("source");
  let referrerPathname: string | null = null;

  if (document.referrer) {
    try {
      referrerPathname = new URL(document.referrer).pathname;
    } catch {
      referrerPathname = null;
    }
  }

  return resolveReservationAnalyticsSource({ explicitSource, referrerPathname });
};

const getCommonProperties = ({
  reservationId,
  reservationStatus,
  source,
  properties,
}: ReservationAnalyticsProperties) => ({
  ...reservationManagementAnalyticsBaseProperties,
  reservation_id: reservationId,
  reservation_status: reservationStatus ?? null,
  source: source ?? getBrowserReservationSource(),
  ...properties,
});

export const captureReservationViewed = (properties: ReservationAnalyticsProperties) => {
  posthog.capture(productAnalyticsEvents.reservationViewed, getCommonProperties(properties));
};

export const captureReservationActionStarted = ({
  action,
  ...properties
}: ReservationActionAnalyticsProperties) => {
  posthog.capture(productAnalyticsEvents.reservationActionStarted, {
    ...getCommonProperties(properties),
    action,
  });
};

export const captureReservationActionSucceeded = ({
  action,
  ...properties
}: ReservationActionAnalyticsProperties) => {
  posthog.capture(productAnalyticsEvents.reservationActionSucceeded, {
    ...getCommonProperties(properties),
    action,
  });
};

export const captureReservationActionFailed = ({
  action,
  ...properties
}: ReservationActionAnalyticsProperties) => {
  posthog.capture(productAnalyticsEvents.reservationActionFailed, {
    ...getCommonProperties(properties),
    action,
  });
};

export const captureReservationQuickActionsViewed = ({
  visibleActions,
  ...properties
}: ReservationQuickActionsViewedProperties) => {
  posthog.capture(productAnalyticsEvents.reservationQuickActionsViewed, {
    ...getCommonProperties(properties),
    entry_point: "mobile_quick_actions",
    visible_actions: visibleActions,
    action_count: visibleActions.length,
  });
};

export const captureReservationQuickActionClicked = ({
  action,
  slot,
  ...properties
}: ReservationQuickActionClickedProperties) => {
  posthog.capture(productAnalyticsEvents.reservationQuickActionClicked, {
    ...getCommonProperties(properties),
    entry_point: "mobile_quick_actions",
    action,
    slot,
  });
};

/** A refund of an online payment sent from the payment history: its outcome, no amount, no person. */
export const captureStripeRefundRequested = ({
  outcome,
  scope,
  reason,
  ...properties
}: StripeRefundRequestedProperties) => {
  posthog.capture(productAnalyticsEvents.stripeRefundRequested, {
    ...getCommonProperties(properties),
    outcome,
    refund_scope: scope,
    refund_reason: reason,
  });
};
