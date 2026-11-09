import { supplementalMessages } from "@/lib/i18n/supplemental-messages";
/**
 * Localized Web Push payload builders, mirroring the admin SMS/Discord template
 * approach: one title per event dispatchNotification can push. The admin
 * reminders go through dispatchAdminReminder, which has no push channel.
 */
import type { NotificationEventType } from "@louez/types";
import { formatCurrencyForSms } from "@louez/utils";

import type { EmailLocale } from "@/lib/email/i18n";
import type { NotificationContext } from "@/lib/notifications/dispatcher";
import {
  paymentCurrencyOf,
  reservationCurrencyOf,
} from "@/lib/notifications/util.notification-currency";

import type { PushPayload } from "./client";

type PushEventType = Exclude<
  NotificationEventType,
  "reservation_reminder_pickup" | "reservation_reminder_return"
>;

function supplementalTitles(
  locale: keyof typeof supplementalMessages,
): Record<PushEventType, string> {
  const messages = supplementalMessages[locale];
  return {
    reservation_new: messages.notifications_NEW_RESERVATION_TITLE,
    reservation_confirmed: messages.notifications_RESERVATION_CONFIRMED_TITLE,
    reservation_rejected: messages.notifications_RESERVATION_REJECTED_TITLE,
    reservation_cancelled: messages.notifications_RESERVATION_CANCELLED_TITLE,
    reservation_picked_up: messages.notifications_RESERVATION_PICKED_UP_TITLE,
    reservation_completed: messages.notifications_RESERVATION_COMPLETED_TITLE,
    payment_received: messages.notifications_PAYMENT_RECEIVED_TITLE,
    payment_failed: messages.notifications_PAYMENT_FAILED_TITLE,
    payment_disputed: messages.notifications_PAYMENT_DISPUTED_TITLE,
  };
}

// Title per event and locale (13 languages). The body is data-only
// (customer · #number · amount), so it needs no translation.
const PUSH_TITLES: Record<EmailLocale, Record<PushEventType, string>> = {
  fr: {
    reservation_new: "Nouvelle réservation",
    reservation_confirmed: "Réservation confirmée",
    reservation_rejected: "Réservation refusée",
    reservation_cancelled: "Réservation annulée",
    reservation_picked_up: "Matériel retiré",
    reservation_completed: "Réservation terminée",
    payment_received: "Paiement reçu",
    payment_failed: "Échec du paiement",
    payment_disputed: "Paiement contesté",
  },
  en: {
    reservation_new: "New reservation",
    reservation_confirmed: "Reservation confirmed",
    reservation_rejected: "Reservation rejected",
    reservation_cancelled: "Reservation cancelled",
    reservation_picked_up: "Equipment picked up",
    reservation_completed: "Reservation completed",
    payment_received: "Payment received",
    payment_failed: "Payment failed",
    payment_disputed: "Payment disputed",
  },
  de: {
    reservation_new: "Neue Reservierung",
    reservation_confirmed: "Reservierung bestätigt",
    reservation_rejected: "Reservierung abgelehnt",
    reservation_cancelled: "Reservierung storniert",
    reservation_picked_up: "Ausrüstung abgeholt",
    reservation_completed: "Reservierung abgeschlossen",
    payment_received: "Zahlung erhalten",
    payment_failed: "Zahlung fehlgeschlagen",
    payment_disputed: "Zahlung angefochten",
  },
  es: {
    reservation_new: "Nueva reserva",
    reservation_confirmed: "Reserva confirmada",
    reservation_rejected: "Reserva rechazada",
    reservation_cancelled: "Reserva cancelada",
    reservation_picked_up: "Equipo recogido",
    reservation_completed: "Reserva completada",
    payment_received: "Pago recibido",
    payment_failed: "Pago fallido",
    payment_disputed: "Pago impugnado",
  },
  it: {
    reservation_new: "Nuova prenotazione",
    reservation_confirmed: "Prenotazione confermata",
    reservation_rejected: "Prenotazione rifiutata",
    reservation_cancelled: "Prenotazione annullata",
    reservation_picked_up: "Attrezzatura ritirata",
    reservation_completed: "Prenotazione completata",
    payment_received: "Pagamento ricevuto",
    payment_failed: "Pagamento non riuscito",
    payment_disputed: "Pagamento contestato",
  },
  nl: {
    reservation_new: "Nieuwe reservering",
    reservation_confirmed: "Reservering bevestigd",
    reservation_rejected: "Reservering geweigerd",
    reservation_cancelled: "Reservering geannuleerd",
    reservation_picked_up: "Materiaal opgehaald",
    reservation_completed: "Reservering afgerond",
    payment_received: "Betaling ontvangen",
    payment_failed: "Betaling mislukt",
    payment_disputed: "Betaling betwist",
  },
  pl: {
    reservation_new: "Nowa rezerwacja",
    reservation_confirmed: "Rezerwacja potwierdzona",
    reservation_rejected: "Rezerwacja odrzucona",
    reservation_cancelled: "Rezerwacja anulowana",
    reservation_picked_up: "Sprzęt odebrany",
    reservation_completed: "Rezerwacja zakończona",
    payment_received: "Płatność otrzymana",
    payment_failed: "Płatność nieudana",
    payment_disputed: "Płatność zakwestionowana",
  },
  pt: {
    reservation_new: "Nova reserva",
    reservation_confirmed: "Reserva confirmada",
    reservation_rejected: "Reserva recusada",
    reservation_cancelled: "Reserva cancelada",
    reservation_picked_up: "Equipamento retirado",
    reservation_completed: "Reserva concluída",
    payment_received: "Pagamento recebido",
    payment_failed: "Falha no pagamento",
    payment_disputed: "Pagamento contestado",
  },

  zh: supplementalTitles("zh"),
  ja: supplementalTitles("ja"),
  ru: supplementalTitles("ru"),
  id: supplementalTitles("id"),
  ko: supplementalTitles("ko"),
};

const isPushEvent = (eventType: NotificationEventType): eventType is PushEventType =>
  eventType !== "reservation_reminder_pickup" && eventType !== "reservation_reminder_return";

export function buildAdminPushPayload(
  eventType: NotificationEventType,
  ctx: NotificationContext,
  locale: EmailLocale,
): PushPayload | null {
  if (!isPushEvent(eventType) || !ctx.reservation) return null;

  const isPayment =
    eventType === "payment_received" ||
    eventType === "payment_failed" ||
    eventType === "payment_disputed";
  const amount =
    isPayment && ctx.payment
      ? formatCurrencyForSms(ctx.payment.amount, paymentCurrencyOf(ctx))
      : formatCurrencyForSms(ctx.reservation.totalAmount, reservationCurrencyOf(ctx));
  const customerName = ctx.customer
    ? `${ctx.customer.firstName} ${ctx.customer.lastName}`.trim()
    : "";
  const title = (PUSH_TITLES[locale] ?? PUSH_TITLES.en)[eventType];
  const bodyParts = [customerName, `#${ctx.reservation.number}`, amount].filter(Boolean);
  return {
    title: `${ctx.store.name} · ${title}`,
    body: bodyParts.join(" · "),
    url: `/dashboard/reservations/${ctx.reservation.id}`,
    tag: `reservation-${ctx.reservation.id}`,
  };
}
