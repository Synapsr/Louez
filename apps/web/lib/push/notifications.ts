/**
 * Localized Web Push payload builders, mirroring the admin SMS/Discord template
 * approach. v1 covers `reservation_new`; other events return null until wired.
 */
import type { NotificationEventType } from '@louez/types';
import { formatCurrencyForSms } from '@louez/utils';

import type { EmailLocale } from '@/lib/email/i18n';
import type { NotificationContext } from '@/lib/notifications/dispatcher';

import type { PushPayload } from './client';

// Title per locale (8 languages). The body is data-only (customer · #number ·
// amount), so it needs no translation.
const NEW_RESERVATION_TITLE: Record<EmailLocale, string> = {
  fr: 'Nouvelle réservation',
  en: 'New reservation',
  de: 'Neue Reservierung',
  es: 'Nueva reserva',
  it: 'Nuova prenotazione',
  nl: 'Nieuwe reservering',
  pl: 'Nowa rezerwacja',
  pt: 'Nova reserva',
};

export function buildAdminPushPayload(
  eventType: NotificationEventType,
  ctx: NotificationContext,
  locale: EmailLocale,
): PushPayload | null {
  switch (eventType) {
    case 'reservation_new': {
      if (!ctx.reservation) return null;
      const amount = formatCurrencyForSms(
        ctx.reservation.totalAmount,
        ctx.store.settings?.currency,
      );
      const customerName = ctx.customer
        ? `${ctx.customer.firstName} ${ctx.customer.lastName}`.trim()
        : '';
      const title = NEW_RESERVATION_TITLE[locale] ?? NEW_RESERVATION_TITLE.en;
      const bodyParts = [
        customerName,
        `#${ctx.reservation.number}`,
        amount,
      ].filter(Boolean);
      return {
        title: `${ctx.store.name} · ${title}`,
        body: bodyParts.join(' · '),
        url: `/dashboard/reservations/${ctx.reservation.id}`,
        tag: `reservation-${ctx.reservation.id}`,
      };
    }
    default:
      // Other events are not part of the push v1 scope.
      return null;
  }
}
