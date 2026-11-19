"use client";

import { useCallback } from "react";

import { usePostHog } from "posthog-js/react";

import type { PartnerCommissionType } from "@louez/api/contracts/partners";

import {
  partnersAnalyticsBaseProperties,
  productAnalyticsEvents,
} from "@/lib/product-analytics/analytics-events";

/** How a partner's link or statement left the dashboard (docs/analytics/partners.md). */
export type PartnerShareChannel = "copy" | "whatsapp" | "email" | "qr" | "space_link";

/**
 * Liens partenaires' PostHog events, on the store's group. Codes and counts
 * only: never a partner's name, contact, link or amount.
 */
export const usePartnersAnalytics = (storeId: string) => {
  const posthog = usePostHog();

  const capture = useCallback(
    (event: string, properties: Record<string, unknown>) => {
      posthog?.capture(event, {
        ...partnersAnalyticsBaseProperties,
        store_id: storeId,
        $groups: { store: storeId },
        ...properties,
      });
    },
    [posthog, storeId],
  );

  return {
    viewed: useCallback(
      (placement: "list" | "partner", partnerCount: number) =>
        capture(productAnalyticsEvents.partnersViewed, { placement, partner_count: partnerCount }),
      [capture],
    ),
    created: useCallback(
      (commissionType: PartnerCommissionType) =>
        capture(productAnalyticsEvents.partnerCreated, { commission_type: commissionType }),
      [capture],
    ),
    linkShared: useCallback(
      (channel: PartnerShareChannel) =>
        capture(productAnalyticsEvents.partnerLinkShared, { channel }),
      [capture],
    ),
    monthPaid: useCallback(
      (bookingCount: number) =>
        capture(productAnalyticsEvents.partnerMonthPaid, { booking_count: bookingCount }),
      [capture],
    ),
    statementExported: useCallback(
      () => capture(productAnalyticsEvents.partnerStatementExported, { format: "csv" }),
      [capture],
    ),
    reservationChanged: useCallback(
      (action: "attributed" | "removed" | "adjusted" | "adjustment_removed") =>
        capture(productAnalyticsEvents.partnerReservationChanged, { action }),
      [capture],
    ),
  };
};
