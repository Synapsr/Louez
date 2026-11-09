import 'server-only';

import type { AnalyticsEventIdentity } from '@louez/api/platform/effects';

import { env } from '@/env';
import { providerSignal } from '@/lib/api/effect-signal';
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

/**
 * Sends one event to PostHog's capture API and checks the answer, for an
 * outbox row: throws when PostHog did not take it (the SDK's flush swallows
 * HTTP failures), answers `skipped` when analytics is not set up here. It
 * honours an outbox sender's abort (lib/api/effect-signal.ts). The caller
 * gives every property, its area's base ones included. `identity` is the
 * row's: the same event id and time on every retry, so PostHog keeps one
 * event (its `uuid` and `timestamp`, as posthog-node sends them).
 */
export async function captureServerEventOrThrow({
  distinctId,
  event,
  properties,
  identity,
}: {
  distinctId: string | null | undefined;
  event: string;
  properties: Record<string, unknown>;
  identity?: Partial<AnalyticsEventIdentity>;
}): Promise<{ skipped: string } | undefined> {
  if (!distinctId) return { skipped: 'no one to count the event on' };
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return { skipped: 'analytics is not set up' };
  const host = (env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com').replace(/\/$/, '');
  const response = await fetch(`${host}/i/v0/e/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: env.NEXT_PUBLIC_POSTHOG_KEY,
      event,
      distinct_id: distinctId,
      // What posthog-node adds to a server event: no GeoIP from the server's
      // address, and the library that sent it.
      properties: {
        ...properties,
        $lib: 'posthog-node',
        $geoip_disable: true,
      },
      timestamp: identity?.occurredAt ?? new Date().toISOString(),
      ...(identity?.eventUuid ? { uuid: identity.eventUuid } : {}),
    }),
    signal: providerSignal(),
  });
  if (!response.ok) throw new Error(`PostHog answered ${response.status}.`);
  return undefined;
}

/** A product event for an outbox row (see `captureServerEventOrThrow`). */
export function captureProductServerEventOrThrow({
  distinctId,
  event,
  properties,
  identity,
}: ProductServerEvent & { identity?: Partial<AnalyticsEventIdentity> }): Promise<
  { skipped: string } | undefined
> {
  return captureServerEventOrThrow({
    distinctId,
    event,
    properties: { ...productAnalyticsBaseProperties, ...properties },
    identity,
  });
}

export async function captureProductServerEvent({
  distinctId,
  event,
  properties,
}: ProductServerEvent) {
  if (!distinctId) return;

  try {
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

const reservationActionEvent = ({
  distinctId,
  storeId,
  reservationId,
  action,
  properties,
}: ReservationActionSucceeded): ProductServerEvent => ({
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

export async function captureReservationActionSucceeded(event: ReservationActionSucceeded) {
  await captureProductServerEvent(reservationActionEvent(event));
}

/**
 * For an outbox row: throws when PostHog did not take the event, so it is retried,
 * with the row's event id and time on every try.
 */
export function captureReservationActionSucceededOrThrow(
  event: ReservationActionSucceeded & { identity?: Partial<AnalyticsEventIdentity> },
) {
  return captureProductServerEventOrThrow({ ...reservationActionEvent(event), identity: event.identity });
}

export function toAnalyticsAmountCents(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;

  const amount = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(amount)) return null;

  return Math.round(amount * 100);
}
