import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import { db, reservations } from '@louez/db';

import type { GoogleCalendarEventInput } from '@/lib/integrations/providers/google-calendar/google-calendar-client';

import { env } from '@/env';

import { buildReservationCalendarDescription } from './reservation-event-details';

const STATUS_PREFIX: Record<string, string> = {
  pending: '[?]',
  confirmed: '[OK]',
  ongoing: '[>>]',
  completed: '[V]',
  cancelled: '[X]',
  rejected: '[X]',
  quote: '[QUOTE]',
  declined: '[X]',
};

// Google Calendar only accepts palette IDs, so these approximate Louez status colors.
const GOOGLE_CALENDAR_COLOR_BY_STATUS: Record<string, string> = {
  pending: '5',
  confirmed: '10',
  ongoing: '9',
  completed: '8',
  cancelled: '6',
  rejected: '11',
  quote: '3',
  declined: '4',
};

function isCancelledStatus(status: string): boolean {
  return status === 'cancelled' || status === 'rejected';
}

export async function buildReservationCalendarEventPayload(params: {
  reservationId: string;
  syncPendingReservations: boolean;
  cancelledReservationBehavior: 'show' | 'hide';
}): Promise<{
  event: GoogleCalendarEventInput | null;
  payloadHash: string;
  shouldDelete: boolean;
}> {
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, params.reservationId),
    with: {
      store: true,
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
    },
  });

  if (!reservation) {
    throw new Error('Reservation not found');
  }

  const cancelled = isCancelledStatus(reservation.status);
  const shouldDelete =
    (cancelled && params.cancelledReservationBehavior === 'hide') ||
    (reservation.status === 'pending' && !params.syncPendingReservations);

  const productNames = reservation.items
    .map((item) => {
      const name =
        item.productSnapshot?.name || item.product?.name || 'Unknown';
      return item.quantity > 1 ? `${name} (x${item.quantity})` : name;
    })
    .join(', ');

  const reservationUrl = `${env.NEXT_PUBLIC_APP_URL}/dashboard/reservations/${reservation.id}`;
  const description = buildReservationCalendarDescription({
    reservation,
    store: reservation.store,
    productNames,
    reservationUrl,
  });

  const summary = `${STATUS_PREFIX[reservation.status] || '[?]'} ${reservation.customer.firstName} ${reservation.customer.lastName} - ${productNames}`;
  const event: GoogleCalendarEventInput = {
    summary,
    description,
    startDate: new Date(reservation.startDate),
    endDate: new Date(reservation.endDate),
    status:
      reservation.status === 'pending' || reservation.status === 'quote'
        ? 'tentative'
        : 'confirmed',
    transparency: 'transparent',
    visibility: 'private',
    colorId: GOOGLE_CALENDAR_COLOR_BY_STATUS[reservation.status] ?? '8',
    url: reservationUrl,
  };
  const payloadHash = createHash('sha256')
    .update(JSON.stringify({ event, shouldDelete }))
    .digest('hex');

  return {
    event: shouldDelete ? null : event,
    payloadHash,
    shouldDelete,
  };
}
