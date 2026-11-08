import 'server-only';

import { getPostHogServer, shutdownPostHogServer } from '@/lib/posthog';
import {
  type ProductAnalyticsEvent,
  productAnalyticsBaseProperties,
  productAnalyticsEvents,
  type ReservationAnalyticsAction,
} from '@/lib/product-analytics/analytics-events';

type ProductServerEvent = {
  distinctId: string | null | undefined;
  event: ProductAnalyticsEvent;
  properties?: Record<string, unknown>;
};

/** Captures and flushes the event; throws when PostHog did not take it. */
export async function captureProductServerEventOrThrow({
  distinctId,
  event,
  properties,
}: ProductServerEvent) {
  if (!distinctId) return;
  const posthog = getPostHogServer();
  posthog.capture({
    distinctId,
    event,
    properties: {
      ...productAnalyticsBaseProperties,
      ...properties,
    },
  });
  await shutdownPostHogServer();
}

export async function captureProductServerEvent(event: ProductServerEvent) {
  try {
    await captureProductServerEventOrThrow(event);
  } catch {
    // Product analytics must never block core product flows.
  }
}

type ReservationActionSucceeded = {
  distinctId: string | null | undefined;
  storeId: string;
  reservationId: string;
  action: ReservationAnalyticsAction;
  properties?: Record<string, unknown>;
};

export async function captureReservationActionSucceeded(event: ReservationActionSucceeded) {
  try {
    await captureReservationActionSucceededOrThrow(event);
  } catch {
    // Product analytics must never block core product flows.
  }
}

/** For an outbox row: throws when PostHog did not take the event, so it is retried. */
export async function captureReservationActionSucceededOrThrow({
  distinctId,
  storeId,
  reservationId,
  action,
  properties,
}: ReservationActionSucceeded) {
  await captureProductServerEventOrThrow({
    distinctId,
    event: productAnalyticsEvents.reservationActionSucceeded,
    properties: {
      feature: 'reservation_management',
      surface: 'dashboard',
      source: 'server_mutation',
      store_id: storeId,
      reservation_id: reservationId,
      action,
      ...properties,
    },
  });
}

export function toAnalyticsAmountCents(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;

  const amount = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(amount)) return null;

  return Math.round(amount * 100);
}
