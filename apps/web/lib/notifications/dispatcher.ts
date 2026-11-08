import { formatSupplementalMessage } from "@/lib/i18n/supplemental-messages";
/**
 * Admin Notification Dispatcher
 *
 * Handles sending notifications to store owners (admins) via multiple channels:
 * - Email (to the store's address, see admin-email.ts)
 * - SMS (to owner phone with full i18n support - 13 languages)
 * - Discord (via webhooks)
 *
 * Supports: fr, en, de, es, it, nl, pl, pt, zh, ja, ru, id, ko
 */

import { db } from "@louez/db";
import { stores, smsLogs, pushSubscriptions, storeMembers } from "@louez/db";
import { eq } from "drizzle-orm";
import { env } from "@/env";
import { getSmsQuotaStatus, determineSmsSource, deductPrepaidSmsCredit } from "@/lib/plan-limits";
import { sendSms, isSmsConfigured } from "@/lib/sms/client";
import { validateAndNormalizePhone } from "@/lib/sms/phone";
import { formatCurrencyForSms } from "@louez/utils";
import { getLocaleFromCountry, getEmailTranslations, type EmailLocale } from "@/lib/email/i18n";
import {
  sendNewReservationDiscord,
  sendReservationConfirmedDiscord,
  sendReservationRejectedDiscord,
  sendReservationCancelledDiscord,
  sendReservationPickedUpDiscord,
  sendReservationCompletedDiscord,
  sendReminderPickupAdminDiscord,
  sendReminderReturnAdminDiscord,
  sendReminderDigestAdminDiscord,
  sendPaymentReceivedDiscord,
  sendPaymentFailedDiscord,
  sendPaymentDisputedDiscord,
} from "@/lib/discord/notifications";
import {
  sendReminderPickupAdminEmail,
  sendReminderReturnAdminEmail,
  sendReminderDigestAdminEmail,
  sendSupplierInvoiceReceivedEmail,
} from "@/lib/email/send";
import type { DigestEntry } from "@/lib/email/templates";
import { sendAdminEventEmail } from "@/lib/notifications/admin-email";
import {
  paymentCurrencyOf,
  reservationCurrencyOf,
} from "@/lib/notifications/util.notification-currency";
import { isPushConfigured, sendPush } from "@/lib/push/client";
import { log } from "@/lib/evlog";
import { buildAdminPushPayload } from "@/lib/push/notifications";
import type { NotificationEventType, NotificationSettings } from "@louez/types";

// ============================================================================
// Types
// ============================================================================

/**
 * Who made the change an event reports: the customer (storefront, marketplace,
 * phone agent), the store (its dashboard, assistant or MCP), or the system
 * (Stripe's webhooks).
 */
export type NotificationActor = "customer" | "store" | "system";

export interface NotificationContext {
  /** Decides, for a confirmation or a cancellation, whether the owner gets an email. */
  actor: NotificationActor;
  /** For a cancellation the customer made: they declined a quote, not a request. */
  quoteDeclined?: boolean;
  store: {
    id: string;
    name: string;
    email?: string | null;
    discordWebhookUrl?: string | null;
    ownerPhone?: string | null;
    notificationSettings?: NotificationSettings | null;
    settings?: {
      currency?: string;
      country?: string;
    } | null;
  };
  reservation?: {
    id: string;
    number: string;
    startDate: Date;
    endDate: Date;
    totalAmount: number;
    /** The customer's message, shown in the new reservation email. */
    customerNotes?: string | null;
    /** The reservation's own currency; the store's when null. */
    currency?: string | null;
  };
  customer?: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
  };
  payment?: {
    amount: number;
    /** The payment's own currency (upper case); the reservation's when absent. */
    currency?: string;
  };
}

/** What dispatchNotification sends the owner's email and SMS with. A test replaces it. */
export interface DispatchNotificationDeps {
  sendAdminEventEmail: typeof sendAdminEventEmail;
  sendAdminSms: typeof sendAdminSms;
}

const defaultDispatchDeps: DispatchNotificationDeps = { sendAdminEventEmail, sendAdminSms };

const describeChannelError = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

export interface NotificationResult {
  email: { sent: boolean; error?: string };
  sms: { sent: boolean; error?: string; limitReached?: boolean };
  discord: { sent: boolean; error?: string };
  push: { sent: boolean; error?: string };
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_SETTINGS: NotificationSettings = {
  reservation_new: { email: true, sms: false, discord: false, push: true },
  reservation_confirmed: { email: true, sms: false, discord: false, push: false },
  reservation_rejected: { email: true, sms: false, discord: false, push: false },
  reservation_cancelled: { email: true, sms: false, discord: false, push: false },
  reservation_picked_up: { email: false, sms: false, discord: false, push: false },
  reservation_completed: { email: false, sms: false, discord: false, push: false },
  reservation_reminder_pickup: { email: false, sms: false, discord: false, push: false },
  reservation_reminder_return: { email: false, sms: false, discord: false, push: false },
  payment_received: { email: true, sms: false, discord: false, push: false },
  payment_failed: { email: true, sms: false, discord: false, push: false },
  payment_disputed: { email: true, sms: false, discord: false, push: false },
};

// ============================================================================
// Admin SMS Templates (i18n - 13 languages)
// ============================================================================

interface AdminSmsTemplateVars {
  storeName: string;
  number: string;
  customerName: string;
  amount: string;
}

type AdminSmsTemplates = {
  reservation_new: (vars: AdminSmsTemplateVars) => string;
  reservation_confirmed: (vars: AdminSmsTemplateVars) => string;
  reservation_rejected: (vars: AdminSmsTemplateVars) => string;
  reservation_cancelled: (vars: AdminSmsTemplateVars) => string;
  reservation_picked_up: (vars: AdminSmsTemplateVars) => string;
  reservation_completed: (vars: AdminSmsTemplateVars) => string;
  reservation_reminder_pickup: (vars: AdminSmsTemplateVars) => string;
  reservation_reminder_return: (vars: AdminSmsTemplateVars) => string;
  payment_received: (vars: AdminSmsTemplateVars) => string;
  payment_failed: (vars: AdminSmsTemplateVars) => string;
  payment_disputed: (vars: AdminSmsTemplateVars) => string;
};

const ADMIN_SMS_TEMPLATES: Record<EmailLocale, AdminSmsTemplates> = {
  fr: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Nouvelle demande #${number} de ${customerName}. Montant: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Réservation #${number} confirmée pour ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Réservation #${number} rejetée`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Réservation #${number} annulée`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Équipement récupéré pour #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Réservation #${number} terminée. ${amount}`,
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Rappel retrait #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Rappel retour #${number} - ${customerName}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Paiement reçu #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) => `[${storeName}] Échec paiement #${number}`,
    payment_disputed: ({ storeName, number, amount }) =>
      `[${storeName}] Paiement contesté #${number} : ${amount}`,
  },
  en: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] New request #${number} from ${customerName}. Amount: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Reservation #${number} confirmed for ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Reservation #${number} rejected`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Reservation #${number} cancelled`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Equipment picked up for #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Reservation #${number} completed. ${amount}`,
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Pickup reminder #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Return reminder #${number} - ${customerName}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Payment received #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) => `[${storeName}] Payment failed #${number}`,
    payment_disputed: ({ storeName, number, amount }) =>
      `[${storeName}] Payment disputed #${number}: ${amount}`,
  },
  de: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Neue Anfrage #${number} von ${customerName}. Betrag: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Reservierung #${number} bestaetigt fuer ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Reservierung #${number} abgelehnt`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Reservierung #${number} storniert`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Ausruestung abgeholt fuer #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Reservierung #${number} abgeschlossen. ${amount}`,
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Erinnerung Abholung #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Erinnerung Rueckgabe #${number} - ${customerName}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Zahlung erhalten #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) => `[${storeName}] Zahlung fehlgeschlagen #${number}`,
    payment_disputed: ({ storeName, number, amount }) =>
      `[${storeName}] Zahlung angefochten #${number}: ${amount}`,
  },
  es: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Nueva solicitud #${number} de ${customerName}. Monto: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Reserva #${number} confirmada para ${customerName}`,
    reservation_rejected: ({ storeName, number }) => `[${storeName}] Reserva #${number} rechazada`,
    reservation_cancelled: ({ storeName, number }) => `[${storeName}] Reserva #${number} cancelada`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Equipo recogido para #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Reserva #${number} completada. ${amount}`,
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Recordatorio recogida #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Recordatorio devolucion #${number} - ${customerName}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Pago recibido #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) => `[${storeName}] Pago fallido #${number}`,
    payment_disputed: ({ storeName, number, amount }) =>
      `[${storeName}] Pago impugnado #${number}: ${amount}`,
  },
  it: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Nuova richiesta #${number} da ${customerName}. Importo: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Prenotazione #${number} confermata per ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Prenotazione #${number} rifiutata`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Prenotazione #${number} annullata`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Attrezzatura ritirata per #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Prenotazione #${number} completata. ${amount}`,
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Promemoria ritiro #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Promemoria reso #${number} - ${customerName}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Pagamento ricevuto #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) => `[${storeName}] Pagamento fallito #${number}`,
    payment_disputed: ({ storeName, number, amount }) =>
      `[${storeName}] Pagamento contestato #${number}: ${amount}`,
  },
  nl: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Nieuwe aanvraag #${number} van ${customerName}. Bedrag: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Reservering #${number} bevestigd voor ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Reservering #${number} afgewezen`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Reservering #${number} geannuleerd`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Apparatuur opgehaald voor #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Reservering #${number} voltooid. ${amount}`,
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Herinnering ophalen #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Herinnering retour #${number} - ${customerName}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Betaling ontvangen #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) => `[${storeName}] Betaling mislukt #${number}`,
    payment_disputed: ({ storeName, number, amount }) =>
      `[${storeName}] Betaling betwist #${number}: ${amount}`,
  },
  pl: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Nowe zamowienie #${number} od ${customerName}. Kwota: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Rezerwacja #${number} potwierdzona dla ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Rezerwacja #${number} odrzucona`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Rezerwacja #${number} anulowana`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Sprzet odebrany dla #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Rezerwacja #${number} zakonczona. ${amount}`,
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Przypomnienie odbioru #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Przypomnienie zwrotu #${number} - ${customerName}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Platnosc otrzymana #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) => `[${storeName}] Platnosc nieudana #${number}`,
    payment_disputed: ({ storeName, number, amount }) =>
      `[${storeName}] Platnosc zakwestionowana #${number}: ${amount}`,
  },
  pt: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Nova solicitacao #${number} de ${customerName}. Valor: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Reserva #${number} confirmada para ${customerName}`,
    reservation_rejected: ({ storeName, number }) => `[${storeName}] Reserva #${number} rejeitada`,
    reservation_cancelled: ({ storeName, number }) => `[${storeName}] Reserva #${number} cancelada`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Equipamento retirado para #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Reserva #${number} concluida. ${amount}`,
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Lembrete retirada #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Lembrete devolucao #${number} - ${customerName}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Pagamento recebido #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) => `[${storeName}] Pagamento falhou #${number}`,
    payment_disputed: ({ storeName, number, amount }) =>
      `[${storeName}] Pagamento contestado #${number}: ${amount}`,
  },

  zh: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      formatSupplementalMessage("zh", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_new", {
        value0: String(storeName),
        value1: String(number),
        value2: String(customerName),
        value3: String(amount),
      }),
    reservation_confirmed: ({ storeName, number, customerName }) =>
      formatSupplementalMessage("zh", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_confirmed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(customerName),
      }),
    reservation_rejected: ({ storeName, number }) =>
      formatSupplementalMessage("zh", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_rejected", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_cancelled: ({ storeName, number }) =>
      formatSupplementalMessage("zh", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_cancelled", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_picked_up: ({ storeName, number }) =>
      formatSupplementalMessage("zh", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_picked_up", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_completed: ({ storeName, number, amount }) =>
      formatSupplementalMessage("zh", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_completed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      formatSupplementalMessage(
        "zh",
        "dispatcher_ADMIN_SMS_TEMPLATES_reservation_reminder_pickup",
        { value0: String(storeName), value1: String(number), value2: String(customerName) },
      ),
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      formatSupplementalMessage(
        "zh",
        "dispatcher_ADMIN_SMS_TEMPLATES_reservation_reminder_return",
        { value0: String(storeName), value1: String(number), value2: String(customerName) },
      ),
    payment_received: ({ storeName, number, amount }) =>
      formatSupplementalMessage("zh", "dispatcher_ADMIN_SMS_TEMPLATES_payment_received", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
    payment_failed: ({ storeName, number }) =>
      formatSupplementalMessage("zh", "dispatcher_ADMIN_SMS_TEMPLATES_payment_failed", {
        value0: String(storeName),
        value1: String(number),
      }),
    payment_disputed: ({ storeName, number, amount }) =>
      formatSupplementalMessage("zh", "dispatcher_ADMIN_SMS_TEMPLATES_payment_disputed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
  },
  ja: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      formatSupplementalMessage("ja", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_new", {
        value0: String(storeName),
        value1: String(number),
        value2: String(customerName),
        value3: String(amount),
      }),
    reservation_confirmed: ({ storeName, number, customerName }) =>
      formatSupplementalMessage("ja", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_confirmed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(customerName),
      }),
    reservation_rejected: ({ storeName, number }) =>
      formatSupplementalMessage("ja", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_rejected", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_cancelled: ({ storeName, number }) =>
      formatSupplementalMessage("ja", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_cancelled", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_picked_up: ({ storeName, number }) =>
      formatSupplementalMessage("ja", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_picked_up", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_completed: ({ storeName, number, amount }) =>
      formatSupplementalMessage("ja", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_completed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      formatSupplementalMessage(
        "ja",
        "dispatcher_ADMIN_SMS_TEMPLATES_reservation_reminder_pickup",
        { value0: String(storeName), value1: String(number), value2: String(customerName) },
      ),
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      formatSupplementalMessage(
        "ja",
        "dispatcher_ADMIN_SMS_TEMPLATES_reservation_reminder_return",
        { value0: String(storeName), value1: String(number), value2: String(customerName) },
      ),
    payment_received: ({ storeName, number, amount }) =>
      formatSupplementalMessage("ja", "dispatcher_ADMIN_SMS_TEMPLATES_payment_received", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
    payment_failed: ({ storeName, number }) =>
      formatSupplementalMessage("ja", "dispatcher_ADMIN_SMS_TEMPLATES_payment_failed", {
        value0: String(storeName),
        value1: String(number),
      }),
    payment_disputed: ({ storeName, number, amount }) =>
      formatSupplementalMessage("ja", "dispatcher_ADMIN_SMS_TEMPLATES_payment_disputed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
  },
  ru: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      formatSupplementalMessage("ru", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_new", {
        value0: String(storeName),
        value1: String(number),
        value2: String(customerName),
        value3: String(amount),
      }),
    reservation_confirmed: ({ storeName, number, customerName }) =>
      formatSupplementalMessage("ru", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_confirmed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(customerName),
      }),
    reservation_rejected: ({ storeName, number }) =>
      formatSupplementalMessage("ru", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_rejected", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_cancelled: ({ storeName, number }) =>
      formatSupplementalMessage("ru", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_cancelled", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_picked_up: ({ storeName, number }) =>
      formatSupplementalMessage("ru", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_picked_up", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_completed: ({ storeName, number, amount }) =>
      formatSupplementalMessage("ru", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_completed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      formatSupplementalMessage(
        "ru",
        "dispatcher_ADMIN_SMS_TEMPLATES_reservation_reminder_pickup",
        { value0: String(storeName), value1: String(number), value2: String(customerName) },
      ),
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      formatSupplementalMessage(
        "ru",
        "dispatcher_ADMIN_SMS_TEMPLATES_reservation_reminder_return",
        { value0: String(storeName), value1: String(number), value2: String(customerName) },
      ),
    payment_received: ({ storeName, number, amount }) =>
      formatSupplementalMessage("ru", "dispatcher_ADMIN_SMS_TEMPLATES_payment_received", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
    payment_failed: ({ storeName, number }) =>
      formatSupplementalMessage("ru", "dispatcher_ADMIN_SMS_TEMPLATES_payment_failed", {
        value0: String(storeName),
        value1: String(number),
      }),
    payment_disputed: ({ storeName, number, amount }) =>
      formatSupplementalMessage("ru", "dispatcher_ADMIN_SMS_TEMPLATES_payment_disputed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
  },
  id: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      formatSupplementalMessage("id", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_new", {
        value0: String(storeName),
        value1: String(number),
        value2: String(customerName),
        value3: String(amount),
      }),
    reservation_confirmed: ({ storeName, number, customerName }) =>
      formatSupplementalMessage("id", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_confirmed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(customerName),
      }),
    reservation_rejected: ({ storeName, number }) =>
      formatSupplementalMessage("id", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_rejected", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_cancelled: ({ storeName, number }) =>
      formatSupplementalMessage("id", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_cancelled", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_picked_up: ({ storeName, number }) =>
      formatSupplementalMessage("id", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_picked_up", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_completed: ({ storeName, number, amount }) =>
      formatSupplementalMessage("id", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_completed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      formatSupplementalMessage(
        "id",
        "dispatcher_ADMIN_SMS_TEMPLATES_reservation_reminder_pickup",
        { value0: String(storeName), value1: String(number), value2: String(customerName) },
      ),
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      formatSupplementalMessage(
        "id",
        "dispatcher_ADMIN_SMS_TEMPLATES_reservation_reminder_return",
        { value0: String(storeName), value1: String(number), value2: String(customerName) },
      ),
    payment_received: ({ storeName, number, amount }) =>
      formatSupplementalMessage("id", "dispatcher_ADMIN_SMS_TEMPLATES_payment_received", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
    payment_failed: ({ storeName, number }) =>
      formatSupplementalMessage("id", "dispatcher_ADMIN_SMS_TEMPLATES_payment_failed", {
        value0: String(storeName),
        value1: String(number),
      }),
    payment_disputed: ({ storeName, number, amount }) =>
      formatSupplementalMessage("id", "dispatcher_ADMIN_SMS_TEMPLATES_payment_disputed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
  },
  ko: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      formatSupplementalMessage("ko", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_new", {
        value0: String(storeName),
        value1: String(number),
        value2: String(customerName),
        value3: String(amount),
      }),
    reservation_confirmed: ({ storeName, number, customerName }) =>
      formatSupplementalMessage("ko", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_confirmed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(customerName),
      }),
    reservation_rejected: ({ storeName, number }) =>
      formatSupplementalMessage("ko", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_rejected", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_cancelled: ({ storeName, number }) =>
      formatSupplementalMessage("ko", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_cancelled", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_picked_up: ({ storeName, number }) =>
      formatSupplementalMessage("ko", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_picked_up", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_completed: ({ storeName, number, amount }) =>
      formatSupplementalMessage("ko", "dispatcher_ADMIN_SMS_TEMPLATES_reservation_completed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      formatSupplementalMessage(
        "ko",
        "dispatcher_ADMIN_SMS_TEMPLATES_reservation_reminder_pickup",
        { value0: String(storeName), value1: String(number), value2: String(customerName) },
      ),
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      formatSupplementalMessage(
        "ko",
        "dispatcher_ADMIN_SMS_TEMPLATES_reservation_reminder_return",
        { value0: String(storeName), value1: String(number), value2: String(customerName) },
      ),
    payment_received: ({ storeName, number, amount }) =>
      formatSupplementalMessage("ko", "dispatcher_ADMIN_SMS_TEMPLATES_payment_received", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
    payment_failed: ({ storeName, number }) =>
      formatSupplementalMessage("ko", "dispatcher_ADMIN_SMS_TEMPLATES_payment_failed", {
        value0: String(storeName),
        value1: String(number),
      }),
    payment_disputed: ({ storeName, number, amount }) =>
      formatSupplementalMessage("ko", "dispatcher_ADMIN_SMS_TEMPLATES_payment_disputed", {
        value0: String(storeName),
        value1: String(number),
        value2: String(amount),
      }),
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build localized SMS message for admin notification
 */
function buildAdminSmsMessage(
  eventType: NotificationEventType,
  ctx: NotificationContext,
  locale: EmailLocale,
): string {
  const templates = ADMIN_SMS_TEMPLATES[locale] || ADMIN_SMS_TEMPLATES.en;
  const templateFn = templates[eventType];

  const vars: AdminSmsTemplateVars = {
    storeName: ctx.store.name,
    number: ctx.reservation?.number || "",
    customerName: ctx.customer ? `${ctx.customer.firstName} ${ctx.customer.lastName}` : "",
    amount: ctx.payment
      ? formatCurrencyForSms(ctx.payment.amount, paymentCurrencyOf(ctx))
      : ctx.reservation
        ? formatCurrencyForSms(ctx.reservation.totalAmount, reservationCurrencyOf(ctx))
        : "",
  };

  return templateFn(vars);
}

/**
 * Send SMS to store owner (admin notification)
 */
async function sendAdminSms(
  storeId: string,
  ownerPhone: string,
  eventType: string,
  message: string,
  reservationId?: string,
): Promise<{ success: boolean; error?: string; limitReached?: boolean }> {
  // Check if SMS is configured
  if (!isSmsConfigured()) {
    return { success: false, error: "SMS not configured" };
  }

  // Check quota
  const quota = await getSmsQuotaStatus(storeId);
  if (!quota.allowed) {
    return {
      success: false,
      error: "SMS limit reached",
      limitReached: true,
    };
  }

  // Validate and normalize phone number
  const phoneResult = validateAndNormalizePhone(ownerPhone);
  if (!phoneResult.valid || !phoneResult.normalized) {
    return { success: false, error: phoneResult.error || "Invalid phone number" };
  }
  const formattedPhone = phoneResult.normalized;

  // Determine credit source
  const creditSource = await determineSmsSource(storeId);

  // Send SMS
  const result = await sendSms({
    to: formattedPhone,
    message,
  });

  // Log the SMS
  await db.insert(smsLogs).values({
    storeId,
    reservationId,
    to: formattedPhone,
    message,
    templateType: `admin_${eventType}`,
    status: result.success ? "sent" : "failed",
    error: result.error,
    creditSource,
  });

  // Deduct prepaid credit if needed
  if (result.success && creditSource === "topup") {
    await deductPrepaidSmsCredit(storeId);
  }

  return result;
}

/**
 * Get Discord sender function for event type
 */
function getDiscordSender(eventType: NotificationEventType) {
  switch (eventType) {
    case "reservation_new":
      return sendNewReservationDiscord;
    case "reservation_confirmed":
      return sendReservationConfirmedDiscord;
    case "reservation_rejected":
      return sendReservationRejectedDiscord;
    case "reservation_cancelled":
      return sendReservationCancelledDiscord;
    case "reservation_picked_up":
      return sendReservationPickedUpDiscord;
    case "reservation_completed":
      return sendReservationCompletedDiscord;
    case "reservation_reminder_pickup":
      return sendReminderPickupAdminDiscord;
    case "reservation_reminder_return":
      return sendReminderReturnAdminDiscord;
    case "payment_received":
      return sendPaymentReceivedDiscord;
    case "payment_failed":
      return sendPaymentFailedDiscord;
    case "payment_disputed":
      return sendPaymentDisputedDiscord;
    default:
      return async () => ({ success: false, error: "Unknown event type" });
  }
}

// ============================================================================
// Main Dispatch Function
// ============================================================================

/**
 * Dispatch notification to all enabled channels
 *
 * @param eventType - The type of event that triggered the notification
 * @param ctx - Context containing store, reservation, customer, and payment info
 * @returns Results for each channel (email, sms, discord, push)
 */
export async function dispatchNotification(
  eventType: NotificationEventType,
  ctx: NotificationContext,
  deps: DispatchNotificationDeps = defaultDispatchDeps,
): Promise<NotificationResult> {
  const result: NotificationResult = {
    email: { sent: false },
    sms: { sent: false },
    discord: { sent: false },
    push: { sent: false },
  };

  // Get notification preferences (use defaults if not set). Merge per-channel
  // over the defaults so stores saved before a channel existed (e.g. `push`)
  // still inherit that channel's default instead of resolving to undefined.
  const settings = ctx.store.notificationSettings || DEFAULT_SETTINGS;
  const prefs = { ...DEFAULT_SETTINGS[eventType], ...settings[eventType] };

  // Determine locale from store country
  const locale = getLocaleFromCountry(ctx.store.settings?.country);

  // Each channel answers for itself: one that throws never hides another's
  // outcome. Callers often drop the result, so a channel that threw is logged here.
  const failed = (channel: string, error: unknown) => {
    log.error(
      "notifications",
      `${eventType} ${channel} to the owner of store ${ctx.store.id} failed: ${describeChannelError(error)}`,
    );
  };

  // Email to the store owner. Events without an owner template answer "not sent".
  if (prefs.email) {
    try {
      result.email = await deps.sendAdminEventEmail(eventType, ctx);
    } catch (error) {
      failed("email", error);
      result.email = { sent: false, error: describeChannelError(error) };
    }
  }

  // SMS notification to store owner
  if (prefs.sms && ctx.store.ownerPhone) {
    try {
      const message = buildAdminSmsMessage(eventType, ctx, locale);
      const smsResult = await deps.sendAdminSms(
        ctx.store.id,
        ctx.store.ownerPhone,
        eventType,
        message,
        ctx.reservation?.id,
      );
      result.sms = {
        sent: smsResult.success,
        error: smsResult.error,
        limitReached: smsResult.limitReached,
      };
    } catch (error) {
      failed("sms", error);
      result.sms = { sent: false, error: describeChannelError(error) };
    }
  }

  // Web push to every store member's registered devices
  if (prefs.push && isPushConfigured()) {
    try {
      const payload = buildAdminPushPayload(eventType, ctx, locale);
      if (payload) {
        const subs = await db
          .select({
            id: pushSubscriptions.id,
            endpoint: pushSubscriptions.endpoint,
            p256dh: pushSubscriptions.p256dh,
            auth: pushSubscriptions.auth,
          })
          .from(pushSubscriptions)
          .innerJoin(storeMembers, eq(storeMembers.userId, pushSubscriptions.userId))
          .where(eq(storeMembers.storeId, ctx.store.id));

        for (const sub of subs) {
          const sendResult = await sendPush(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
          );
          if (sendResult.success) {
            result.push.sent = true;
          } else if (sendResult.statusCode === 404 || sendResult.statusCode === 410) {
            // Endpoint is gone — prune the dead subscription.
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          }
        }
      }
    } catch (error) {
      failed("push", error);
      result.push.error = error instanceof Error ? error.message : "Unknown error";
    }
  }

  // Discord notification
  if (prefs.discord && ctx.store.discordWebhookUrl) {
    const discordCtx = {
      store: {
        id: ctx.store.id,
        name: ctx.store.name,
        discordWebhookUrl: ctx.store.discordWebhookUrl,
      },
      reservation: ctx.reservation
        ? {
            ...ctx.reservation,
            currency: reservationCurrencyOf(ctx),
          }
        : undefined,
      customer: ctx.customer,
      payment: ctx.payment
        ? {
            ...ctx.payment,
            currency: paymentCurrencyOf(ctx),
          }
        : undefined,
    };

    try {
      const discordResult = await getDiscordSender(eventType)(discordCtx);
      result.discord = { sent: discordResult?.success ?? false, error: discordResult?.error };
    } catch (error) {
      failed("discord", error);
      result.discord = {
        sent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  return result;
}

export interface SupplierInvoiceNotificationContext {
  storeId: string;
  invoice: {
    sellerName: string;
    number: string;
    totalInclTax: string;
    currency: string;
  };
}

/**
 * Supplier invoice receipt has no configurable NotificationEventType. This
 * dedicated dispatcher therefore owns the required email to the store address
 * without borrowing an unrelated reservation or payment preference.
 */
export async function dispatchSupplierInvoiceReceived(
  ctx: SupplierInvoiceNotificationContext,
): Promise<void> {
  const [store] = await db
    .select({
      id: stores.id,
      name: stores.name,
      email: stores.email,
      theme: stores.theme,
      settings: stores.settings,
    })
    .from(stores)
    .where(eq(stores.id, ctx.storeId))
    .limit(1);

  if (!store?.email) return;

  const storeLocale = getLocaleFromCountry(store.settings?.country);
  const locale: EmailLocale = storeLocale === "fr" ? "fr" : "en";
  await sendSupplierInvoiceReceivedEmail({
    to: store.email,
    store,
    invoice: ctx.invoice,
    dashboardUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard/purchase-invoices`,
    locale,
  });
}

// ============================================================================
// Admin Reminder Dispatch
// ============================================================================

export type AdminReminderEventType = "reservation_reminder_pickup" | "reservation_reminder_return";

export interface AdminReminderContext {
  store: {
    id: string;
    name: string;
    email?: string | null;
    logoUrl?: string | null;
    darkLogoUrl?: string | null;
    address?: string | null;
    phone?: string | null;
    ownerPhone?: string | null;
    discordWebhookUrl?: string | null;
    theme?: { mode?: "light" | "dark"; primaryColor?: string } | null;
    notificationSettings?: NotificationSettings | null;
    settings?: {
      currency?: string;
      country?: string;
      timezone?: string;
    } | null;
  };
  reservation: {
    id: string;
    number: string;
    startDate: Date;
    endDate: Date;
    totalAmount: number;
  };
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
  };
  dashboardUrl: string;
}

/**
 * Dispatch an automatic admin reminder (upcoming pickup / return) to the store
 * owner across all enabled channels.
 *
 * Reminders are cron-driven and have their own email templates, so this sends
 * the email itself. SMS and Discord reuse the same infrastructure.
 */
export async function dispatchAdminReminder(
  eventType: AdminReminderEventType,
  ctx: AdminReminderContext,
): Promise<NotificationResult> {
  const result: NotificationResult = {
    email: { sent: false },
    sms: { sent: false },
    discord: { sent: false },
    push: { sent: false },
  };

  const settings = ctx.store.notificationSettings || DEFAULT_SETTINGS;
  const prefs = settings[eventType] || DEFAULT_SETTINGS[eventType];
  const locale = getLocaleFromCountry(ctx.store.settings?.country);

  // Email to store owner
  if (prefs.email && ctx.store.email) {
    try {
      const emailArgs = {
        to: ctx.store.email,
        store: ctx.store,
        customer: ctx.customer,
        dashboardUrl: ctx.dashboardUrl,
        locale,
      };
      if (eventType === "reservation_reminder_pickup") {
        await sendReminderPickupAdminEmail({
          ...emailArgs,
          reservation: {
            id: ctx.reservation.id,
            number: ctx.reservation.number,
            startDate: ctx.reservation.startDate,
            totalAmount: ctx.reservation.totalAmount,
          },
        });
      } else {
        await sendReminderReturnAdminEmail({
          ...emailArgs,
          reservation: {
            id: ctx.reservation.id,
            number: ctx.reservation.number,
            endDate: ctx.reservation.endDate,
            totalAmount: ctx.reservation.totalAmount,
          },
        });
      }
      result.email.sent = true;
    } catch (error) {
      result.email.error = error instanceof Error ? error.message : "Unknown error";
      console.error(`Failed to send admin reminder email for ${eventType}:`, error);
    }
  }

  // SMS to store owner
  if (prefs.sms && ctx.store.ownerPhone) {
    const message = buildAdminSmsMessage(
      eventType,
      {
        actor: "system",
        store: ctx.store,
        reservation: ctx.reservation,
        customer: ctx.customer,
      },
      locale,
    );
    const smsResult = await sendAdminSms(
      ctx.store.id,
      ctx.store.ownerPhone,
      eventType,
      message,
      ctx.reservation.id,
    );
    result.sms = {
      sent: smsResult.success,
      error: smsResult.error,
      limitReached: smsResult.limitReached,
    };
  }

  // Discord
  if (prefs.discord && ctx.store.discordWebhookUrl) {
    const discordCtx = {
      store: {
        id: ctx.store.id,
        name: ctx.store.name,
        discordWebhookUrl: ctx.store.discordWebhookUrl,
      },
      reservation: {
        ...ctx.reservation,
        currency: ctx.store.settings?.currency,
      },
      customer: ctx.customer,
    };

    try {
      const discordResult = await getDiscordSender(eventType)(discordCtx);
      result.discord = { sent: discordResult?.success ?? false, error: discordResult?.error };
    } catch (error) {
      result.discord = {
        sent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  return result;
}

// ============================================================================
// Admin Daily Digest
// ============================================================================

// Short SMS summary of the day's pickups/returns (i18n, 13 languages). Kept
// deliberately terse — the digest's job here is to nudge the owner to the
// dashboard, where the full schedule lives.
const ADMIN_DIGEST_SMS: Record<
  EmailLocale,
  (v: { storeName: string; pickups: number; returns: number; url: string }) => string
> = {
  fr: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Aujourd'hui : ${pickups} retrait(s), ${returns} retour(s). ${url}`,
  en: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Today: ${pickups} pickup(s), ${returns} return(s). ${url}`,
  de: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Heute: ${pickups} Abholung(en), ${returns} Rueckgabe(n). ${url}`,
  es: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Hoy: ${pickups} recogida(s), ${returns} devolucion(es). ${url}`,
  it: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Oggi: ${pickups} ritiro/i, ${returns} reso/i. ${url}`,
  nl: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Vandaag: ${pickups} ophaling(en), ${returns} retour(en). ${url}`,
  pl: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Dzisiaj: ${pickups} odbior(ow), ${returns} zwrot(ow). ${url}`,
  pt: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Hoje: ${pickups} retirada(s), ${returns} devolucao(oes). ${url}`,

  zh: ({ storeName, pickups, returns, url }) =>
    formatSupplementalMessage("zh", "dispatcher_ADMIN_DIGEST_SMS", {
      value0: String(storeName),
      value1: String(pickups),
      value2: String(returns),
      value3: String(url),
    }),
  ja: ({ storeName, pickups, returns, url }) =>
    formatSupplementalMessage("ja", "dispatcher_ADMIN_DIGEST_SMS", {
      value0: String(storeName),
      value1: String(pickups),
      value2: String(returns),
      value3: String(url),
    }),
  ru: ({ storeName, pickups, returns, url }) =>
    formatSupplementalMessage("ru", "dispatcher_ADMIN_DIGEST_SMS", {
      value0: String(storeName),
      value1: String(pickups),
      value2: String(returns),
      value3: String(url),
    }),
  id: ({ storeName, pickups, returns, url }) =>
    formatSupplementalMessage("id", "dispatcher_ADMIN_DIGEST_SMS", {
      value0: String(storeName),
      value1: String(pickups),
      value2: String(returns),
      value3: String(url),
    }),
  ko: ({ storeName, pickups, returns, url }) =>
    formatSupplementalMessage("ko", "dispatcher_ADMIN_DIGEST_SMS", {
      value0: String(storeName),
      value1: String(pickups),
      value2: String(returns),
      value3: String(url),
    }),
};

export interface AdminDigestContext {
  store: {
    id: string;
    name: string;
    email?: string | null;
    logoUrl?: string | null;
    darkLogoUrl?: string | null;
    address?: string | null;
    phone?: string | null;
    ownerPhone?: string | null;
    discordWebhookUrl?: string | null;
    theme?: { mode?: "light" | "dark"; primaryColor?: string } | null;
    settings?: {
      currency?: string;
      country?: string;
      timezone?: string;
    } | null;
  };
  /** Localized full date, e.g. "Monday, 9 June 2026". */
  dateLabel: string;
  pickups: DigestEntry[];
  returns: DigestEntry[];
  dashboardUrl: string;
  /** Channels to attempt — already filtered for enabled + not-yet-sent today. */
  channels: { email: boolean; sms: boolean; discord: boolean };
}

/**
 * Dispatch the once-a-day admin digest across the requested channels.
 * Every channel receives the same content (the day's pickups + returns); the
 * caller decides which channels to attempt.
 */
export async function dispatchAdminDigest(ctx: AdminDigestContext): Promise<NotificationResult> {
  const result: NotificationResult = {
    email: { sent: false },
    sms: { sent: false },
    discord: { sent: false },
    push: { sent: false },
  };

  const locale = getLocaleFromCountry(ctx.store.settings?.country);

  // Email
  if (ctx.channels.email && ctx.store.email) {
    try {
      await sendReminderDigestAdminEmail({
        to: ctx.store.email,
        store: ctx.store,
        dateLabel: ctx.dateLabel,
        pickups: ctx.pickups,
        returns: ctx.returns,
        dashboardUrl: ctx.dashboardUrl,
        locale,
      });
      result.email.sent = true;
    } catch (error) {
      result.email.error = error instanceof Error ? error.message : "Unknown error";
      console.error("Failed to send admin digest email:", error);
    }
  }

  // SMS
  if (ctx.channels.sms && ctx.store.ownerPhone) {
    const build = ADMIN_DIGEST_SMS[locale] || ADMIN_DIGEST_SMS.en;
    const message = build({
      storeName: ctx.store.name,
      pickups: ctx.pickups.length,
      returns: ctx.returns.length,
      url: ctx.dashboardUrl,
    });
    const smsResult = await sendAdminSms(ctx.store.id, ctx.store.ownerPhone, "digest", message);
    result.sms = {
      sent: smsResult.success,
      error: smsResult.error,
      limitReached: smsResult.limitReached,
    };
  }

  // Discord
  if (ctx.channels.discord && ctx.store.discordWebhookUrl) {
    try {
      const t = getEmailTranslations(locale);
      const discordResult = await sendReminderDigestAdminDiscord({
        store: {
          id: ctx.store.id,
          name: ctx.store.name,
          discordWebhookUrl: ctx.store.discordWebhookUrl,
        },
        dateLabel: ctx.dateLabel,
        pickupsLabel: t.reminderDigestAdmin.pickupsTitle.replace(
          "{count}",
          String(ctx.pickups.length),
        ),
        returnsLabel: t.reminderDigestAdmin.returnsTitle.replace(
          "{count}",
          String(ctx.returns.length),
        ),
        pickups: ctx.pickups,
        returns: ctx.returns,
      });
      result.discord = { sent: discordResult?.success ?? false, error: discordResult?.error };
    } catch (error) {
      result.discord = {
        sent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Helper to get full store data for notifications
 */
export async function getStoreForNotifications(storeId: string) {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
  });

  if (!store) return null;

  return {
    id: store.id,
    name: store.name,
    email: store.email,
    discordWebhookUrl: store.discordWebhookUrl,
    ownerPhone: store.ownerPhone,
    notificationSettings: store.notificationSettings,
    settings: store.settings,
  };
}
