import { formatSupplementalMessage } from "@/lib/i18n/supplemental-messages";
/**
 * SMS Sending Functions
 *
 * The SMS a store sends its customers: each checks the phone, the
 * configuration and the quota, builds its text (the store's own when it saved
 * one, else the default of its language), then goes out once through
 * `deliverSms`, which records it and its prepaid credit (lib/sms/delivery.ts).
 */

import { isSmsConfigured } from "./client";
import { deliverSms } from "./delivery";
import { validateAndNormalizePhone } from "./phone";
import { getSmsQuotaStatus, determineSmsSource } from "@/lib/plan-limits";
import { getEmailMessages, getLocaleFromCountry, type EmailLocale } from "@/lib/email/i18n";
import { getConfiguredFormatLocale } from "@/lib/i18n/configured-format-locale";

/**
 * Localized SMS templates for customer notifications
 * Keep messages short - SMS are limited to 160 chars for single segment
 */
const SMS_TEMPLATES: Record<
  EmailLocale,
  {
    reservation_confirmation: (vars: {
      storeName: string;
      number: string;
      startDate: string;
      endDate: string;
    }) => string;
    reminder_pickup: (vars: { storeName: string; number: string; date: string }) => string;
    reminder_return: (vars: { storeName: string; number: string; date: string }) => string;
    request_received: (vars: { storeName: string; number: string }) => string;
    request_accepted: (vars: { storeName: string; number: string }) => string;
    request_rejected: (vars: { storeName: string; number: string }) => string;
    reservation_cancelled: (vars: { storeName: string; number: string }) => string;
    instant_access: (vars: { storeName: string; number: string; url: string }) => string;
    payment_request: (vars: {
      storeName: string;
      number: string;
      amount: string;
      url: string;
    }) => string;
    deposit_authorization_request: (vars: {
      storeName: string;
      number: string;
      amount: string;
      url: string;
    }) => string;
  }
> = {
  fr: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nRéservation #${number} confirmée\nDu ${startDate} au ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nRappel: retrait réservation #${number}\nLe ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nRappel: retour réservation #${number}\nLe ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nDemande #${number} reçue. Confirmation sous 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nDemande #${number} acceptée! Consultez vos emails.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nDemande #${number} non disponible. Contactez-nous.`,
    reservation_cancelled: ({ storeName, number }) =>
      `${storeName}\nRéservation #${number} annulée. Contactez-nous pour toute question.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nVotre réservation #${number}\nAccès: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nPaiement de ${amount} demandé pour #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nCaution de ${amount} à autoriser pour #${number}\n${url}`,
  },
  en: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nReservation #${number} confirmed\nFrom ${startDate} to ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nReminder: pickup for #${number}\nOn ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nReminder: return for #${number}\nOn ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nRequest #${number} received. Confirmation within 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nRequest #${number} accepted! Check your email.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nRequest #${number} unavailable. Contact us.`,
    reservation_cancelled: ({ storeName, number }) =>
      `${storeName}\nReservation #${number} cancelled. Contact us with any questions.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nYour reservation #${number}\nAccess: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nPayment of ${amount} requested for #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nDeposit of ${amount} to authorize for #${number}\n${url}`,
  },
  de: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nReservierung #${number} bestaetigt\nVom ${startDate} bis ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nErinnerung: Abholung #${number}\nAm ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nErinnerung: Rueckgabe #${number}\nAm ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nAnfrage #${number} erhalten. Bestaetigung in 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nAnfrage #${number} akzeptiert! E-Mail pruefen.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nAnfrage #${number} nicht verfuegbar. Kontaktieren Sie uns.`,
    reservation_cancelled: ({ storeName, number }) =>
      `${storeName}\nReservierung #${number} storniert. Bei Fragen kontaktieren Sie uns.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nIhre Reservierung #${number}\nZugang: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nZahlung von ${amount} fuer #${number} angefordert\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nKaution von ${amount} fuer #${number} freizugeben\n${url}`,
  },
  es: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nReserva #${number} confirmada\nDel ${startDate} al ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nRecordatorio: recogida #${number}\nEl ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nRecordatorio: devolucion #${number}\nEl ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nSolicitud #${number} recibida. Confirmacion en 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nSolicitud #${number} aceptada! Revisa tu email.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nSolicitud #${number} no disponible. Contactenos.`,
    reservation_cancelled: ({ storeName, number }) =>
      `${storeName}\nReserva #${number} cancelada. Contactenos si tiene preguntas.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nTu reserva #${number}\nAcceso: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nPago de ${amount} solicitado para #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nDeposito de ${amount} a autorizar para #${number}\n${url}`,
  },
  it: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nPrenotazione #${number} confermata\nDal ${startDate} al ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nPromemoria: ritiro #${number}\nIl ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nPromemoria: restituzione #${number}\nIl ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nRichiesta #${number} ricevuta. Conferma entro 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nRichiesta #${number} accettata! Controlla email.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nRichiesta #${number} non disponibile. Contattaci.`,
    reservation_cancelled: ({ storeName, number }) =>
      `${storeName}\nPrenotazione #${number} annullata. Contattaci per qualsiasi domanda.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nLa tua prenotazione #${number}\nAccesso: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nPagamento di ${amount} richiesto per #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nDeposito di ${amount} da autorizzare per #${number}\n${url}`,
  },
  nl: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nReservering #${number} bevestigd\nVan ${startDate} tot ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nHerinnering: ophalen #${number}\nOp ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nHerinnering: terugbrengen #${number}\nOp ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nAanvraag #${number} ontvangen. Bevestiging binnen 24u.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nAanvraag #${number} geaccepteerd! Check je email.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nAanvraag #${number} niet beschikbaar. Neem contact op.`,
    reservation_cancelled: ({ storeName, number }) =>
      `${storeName}\nReservering #${number} geannuleerd. Neem contact op bij vragen.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nUw reservering #${number}\nToegang: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nBetaling van ${amount} gevraagd voor #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nBorg van ${amount} te autoriseren voor #${number}\n${url}`,
  },
  pl: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nRezerwacja #${number} potwierdzona\nOd ${startDate} do ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nPrzypomnienie: odbior #${number}\nDnia ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nPrzypomnienie: zwrot #${number}\nDnia ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nZamowienie #${number} otrzymane. Potwierdzenie w 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nZamowienie #${number} zaakceptowane! Sprawdz email.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nZamowienie #${number} niedostepne. Skontaktuj sie.`,
    reservation_cancelled: ({ storeName, number }) =>
      `${storeName}\nRezerwacja #${number} anulowana. Skontaktuj sie z nami w razie pytan.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nTwoja rezerwacja #${number}\nDostep: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nPlatnosc ${amount} wymagana dla #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nKaucja ${amount} do autoryzacji dla #${number}\n${url}`,
  },
  pt: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nReserva #${number} confirmada\nDe ${startDate} a ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nLembrete: retirada #${number}\nEm ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nLembrete: devolucao #${number}\nEm ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nPedido #${number} recebido. Confirmacao em 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nPedido #${number} aceito! Verifique seu email.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nPedido #${number} indisponivel. Entre em contato.`,
    reservation_cancelled: ({ storeName, number }) =>
      `${storeName}\nReserva #${number} cancelada. Entre em contato se tiver duvidas.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nSua reserva #${number}\nAcesso: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nPagamento de ${amount} solicitado para #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nDeposito de ${amount} a autorizar para #${number}\n${url}`,
  },

  zh: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      formatSupplementalMessage("zh", "send_SMS_TEMPLATES_reservation_confirmation", {
        value0: String(storeName),
        value1: String(number),
        value2: String(startDate),
        value3: String(endDate),
      }),
    reminder_pickup: ({ storeName, number, date }) =>
      formatSupplementalMessage("zh", "send_SMS_TEMPLATES_reminder_pickup", {
        value0: String(storeName),
        value1: String(number),
        value2: String(date),
      }),
    reminder_return: ({ storeName, number, date }) =>
      formatSupplementalMessage("zh", "send_SMS_TEMPLATES_reminder_return", {
        value0: String(storeName),
        value1: String(number),
        value2: String(date),
      }),
    request_received: ({ storeName, number }) =>
      formatSupplementalMessage("zh", "send_SMS_TEMPLATES_request_received", {
        value0: String(storeName),
        value1: String(number),
      }),
    request_accepted: ({ storeName, number }) =>
      formatSupplementalMessage("zh", "send_SMS_TEMPLATES_request_accepted", {
        value0: String(storeName),
        value1: String(number),
      }),
    request_rejected: ({ storeName, number }) =>
      formatSupplementalMessage("zh", "send_SMS_TEMPLATES_request_rejected", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_cancelled: ({ storeName, number }) =>
      formatSupplementalMessage("zh", "send_SMS_TEMPLATES_reservation_cancelled", {
        value0: String(storeName),
        value1: String(number),
      }),
    instant_access: ({ storeName, number, url }) =>
      formatSupplementalMessage("zh", "send_SMS_TEMPLATES_instant_access", {
        value0: String(storeName),
        value1: String(number),
        value2: String(url),
      }),
    payment_request: ({ storeName, number, amount, url }) =>
      formatSupplementalMessage("zh", "send_SMS_TEMPLATES_payment_request", {
        value0: String(storeName),
        value1: String(amount),
        value2: String(number),
        value3: String(url),
      }),
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      formatSupplementalMessage("zh", "send_SMS_TEMPLATES_deposit_authorization_request", {
        value0: String(storeName),
        value1: String(amount),
        value2: String(number),
        value3: String(url),
      }),
  },
  ja: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      formatSupplementalMessage("ja", "send_SMS_TEMPLATES_reservation_confirmation", {
        value0: String(storeName),
        value1: String(number),
        value2: String(startDate),
        value3: String(endDate),
      }),
    reminder_pickup: ({ storeName, number, date }) =>
      formatSupplementalMessage("ja", "send_SMS_TEMPLATES_reminder_pickup", {
        value0: String(storeName),
        value1: String(number),
        value2: String(date),
      }),
    reminder_return: ({ storeName, number, date }) =>
      formatSupplementalMessage("ja", "send_SMS_TEMPLATES_reminder_return", {
        value0: String(storeName),
        value1: String(number),
        value2: String(date),
      }),
    request_received: ({ storeName, number }) =>
      formatSupplementalMessage("ja", "send_SMS_TEMPLATES_request_received", {
        value0: String(storeName),
        value1: String(number),
      }),
    request_accepted: ({ storeName, number }) =>
      formatSupplementalMessage("ja", "send_SMS_TEMPLATES_request_accepted", {
        value0: String(storeName),
        value1: String(number),
      }),
    request_rejected: ({ storeName, number }) =>
      formatSupplementalMessage("ja", "send_SMS_TEMPLATES_request_rejected", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_cancelled: ({ storeName, number }) =>
      formatSupplementalMessage("ja", "send_SMS_TEMPLATES_reservation_cancelled", {
        value0: String(storeName),
        value1: String(number),
      }),
    instant_access: ({ storeName, number, url }) =>
      formatSupplementalMessage("ja", "send_SMS_TEMPLATES_instant_access", {
        value0: String(storeName),
        value1: String(number),
        value2: String(url),
      }),
    payment_request: ({ storeName, number, amount, url }) =>
      formatSupplementalMessage("ja", "send_SMS_TEMPLATES_payment_request", {
        value0: String(storeName),
        value1: String(amount),
        value2: String(number),
        value3: String(url),
      }),
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      formatSupplementalMessage("ja", "send_SMS_TEMPLATES_deposit_authorization_request", {
        value0: String(storeName),
        value1: String(amount),
        value2: String(number),
        value3: String(url),
      }),
  },
  ru: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      formatSupplementalMessage("ru", "send_SMS_TEMPLATES_reservation_confirmation", {
        value0: String(storeName),
        value1: String(number),
        value2: String(startDate),
        value3: String(endDate),
      }),
    reminder_pickup: ({ storeName, number, date }) =>
      formatSupplementalMessage("ru", "send_SMS_TEMPLATES_reminder_pickup", {
        value0: String(storeName),
        value1: String(number),
        value2: String(date),
      }),
    reminder_return: ({ storeName, number, date }) =>
      formatSupplementalMessage("ru", "send_SMS_TEMPLATES_reminder_return", {
        value0: String(storeName),
        value1: String(number),
        value2: String(date),
      }),
    request_received: ({ storeName, number }) =>
      formatSupplementalMessage("ru", "send_SMS_TEMPLATES_request_received", {
        value0: String(storeName),
        value1: String(number),
      }),
    request_accepted: ({ storeName, number }) =>
      formatSupplementalMessage("ru", "send_SMS_TEMPLATES_request_accepted", {
        value0: String(storeName),
        value1: String(number),
      }),
    request_rejected: ({ storeName, number }) =>
      formatSupplementalMessage("ru", "send_SMS_TEMPLATES_request_rejected", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_cancelled: ({ storeName, number }) =>
      formatSupplementalMessage("ru", "send_SMS_TEMPLATES_reservation_cancelled", {
        value0: String(storeName),
        value1: String(number),
      }),
    instant_access: ({ storeName, number, url }) =>
      formatSupplementalMessage("ru", "send_SMS_TEMPLATES_instant_access", {
        value0: String(storeName),
        value1: String(number),
        value2: String(url),
      }),
    payment_request: ({ storeName, number, amount, url }) =>
      formatSupplementalMessage("ru", "send_SMS_TEMPLATES_payment_request", {
        value0: String(storeName),
        value1: String(amount),
        value2: String(number),
        value3: String(url),
      }),
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      formatSupplementalMessage("ru", "send_SMS_TEMPLATES_deposit_authorization_request", {
        value0: String(storeName),
        value1: String(amount),
        value2: String(number),
        value3: String(url),
      }),
  },
  id: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      formatSupplementalMessage("id", "send_SMS_TEMPLATES_reservation_confirmation", {
        value0: String(storeName),
        value1: String(number),
        value2: String(startDate),
        value3: String(endDate),
      }),
    reminder_pickup: ({ storeName, number, date }) =>
      formatSupplementalMessage("id", "send_SMS_TEMPLATES_reminder_pickup", {
        value0: String(storeName),
        value1: String(number),
        value2: String(date),
      }),
    reminder_return: ({ storeName, number, date }) =>
      formatSupplementalMessage("id", "send_SMS_TEMPLATES_reminder_return", {
        value0: String(storeName),
        value1: String(number),
        value2: String(date),
      }),
    request_received: ({ storeName, number }) =>
      formatSupplementalMessage("id", "send_SMS_TEMPLATES_request_received", {
        value0: String(storeName),
        value1: String(number),
      }),
    request_accepted: ({ storeName, number }) =>
      formatSupplementalMessage("id", "send_SMS_TEMPLATES_request_accepted", {
        value0: String(storeName),
        value1: String(number),
      }),
    request_rejected: ({ storeName, number }) =>
      formatSupplementalMessage("id", "send_SMS_TEMPLATES_request_rejected", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_cancelled: ({ storeName, number }) =>
      formatSupplementalMessage("id", "send_SMS_TEMPLATES_reservation_cancelled", {
        value0: String(storeName),
        value1: String(number),
      }),
    instant_access: ({ storeName, number, url }) =>
      formatSupplementalMessage("id", "send_SMS_TEMPLATES_instant_access", {
        value0: String(storeName),
        value1: String(number),
        value2: String(url),
      }),
    payment_request: ({ storeName, number, amount, url }) =>
      formatSupplementalMessage("id", "send_SMS_TEMPLATES_payment_request", {
        value0: String(storeName),
        value1: String(amount),
        value2: String(number),
        value3: String(url),
      }),
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      formatSupplementalMessage("id", "send_SMS_TEMPLATES_deposit_authorization_request", {
        value0: String(storeName),
        value1: String(amount),
        value2: String(number),
        value3: String(url),
      }),
  },
  ko: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      formatSupplementalMessage("ko", "send_SMS_TEMPLATES_reservation_confirmation", {
        value0: String(storeName),
        value1: String(number),
        value2: String(startDate),
        value3: String(endDate),
      }),
    reminder_pickup: ({ storeName, number, date }) =>
      formatSupplementalMessage("ko", "send_SMS_TEMPLATES_reminder_pickup", {
        value0: String(storeName),
        value1: String(number),
        value2: String(date),
      }),
    reminder_return: ({ storeName, number, date }) =>
      formatSupplementalMessage("ko", "send_SMS_TEMPLATES_reminder_return", {
        value0: String(storeName),
        value1: String(number),
        value2: String(date),
      }),
    request_received: ({ storeName, number }) =>
      formatSupplementalMessage("ko", "send_SMS_TEMPLATES_request_received", {
        value0: String(storeName),
        value1: String(number),
      }),
    request_accepted: ({ storeName, number }) =>
      formatSupplementalMessage("ko", "send_SMS_TEMPLATES_request_accepted", {
        value0: String(storeName),
        value1: String(number),
      }),
    request_rejected: ({ storeName, number }) =>
      formatSupplementalMessage("ko", "send_SMS_TEMPLATES_request_rejected", {
        value0: String(storeName),
        value1: String(number),
      }),
    reservation_cancelled: ({ storeName, number }) =>
      formatSupplementalMessage("ko", "send_SMS_TEMPLATES_reservation_cancelled", {
        value0: String(storeName),
        value1: String(number),
      }),
    instant_access: ({ storeName, number, url }) =>
      formatSupplementalMessage("ko", "send_SMS_TEMPLATES_instant_access", {
        value0: String(storeName),
        value1: String(number),
        value2: String(url),
      }),
    payment_request: ({ storeName, number, amount, url }) =>
      formatSupplementalMessage("ko", "send_SMS_TEMPLATES_payment_request", {
        value0: String(storeName),
        value1: String(amount),
        value2: String(number),
        value3: String(url),
      }),
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      formatSupplementalMessage("ko", "send_SMS_TEMPLATES_deposit_authorization_request", {
        value0: String(storeName),
        value1: String(amount),
        value2: String(number),
        value3: String(url),
      }),
  },
};

/**
 * Get SMS template for a specific locale, falling back to English
 */
function getSmsTemplate(locale: EmailLocale = "en") {
  return SMS_TEMPLATES[locale] || SMS_TEMPLATES.en;
}

/**
 * Format date for SMS based on locale
 */
function formatSmsDate(
  date: Date,
  locale: EmailLocale,
  options?: Intl.DateTimeFormatOptions,
): string {
  return date.toLocaleDateString(getConfiguredFormatLocale(locale).intl, {
    day: "2-digit",
    month: "2-digit",
    ...options,
  });
}

const formatSmsAmount = (amount: number, currency: string, locale: EmailLocale) =>
  new Intl.NumberFormat(getConfiguredFormatLocale(locale).intl, {
    style: "currency",
    currency,
  }).format(amount);

/**
 * SMS send result with optional limit info for UI handling
 */
export interface SmsSendResult {
  success: boolean;
  error?: string;
  /** The provider's id of a message it accepted. */
  messageId?: string;
  limitReached?: boolean;
  limitInfo?: {
    current: number;
    limit: number;
    planSlug: string;
  };
}

interface Store {
  id: string;
  name: string;
  settings?: {
    country?: string;
  } | null;
}

interface Customer {
  firstName: string;
  lastName: string;
  phone?: string | null;
}

/** The reservation a customer notification SMS is about. */
interface SmsReservation {
  id: string;
  number: string;
  startDate: Date;
  endDate: Date;
}

/** What every customer notification SMS takes. */
interface CustomerNotificationSmsParams {
  store: Store;
  customer: Customer & { id: string };
  reservation: SmsReservation;
  /** The reservation's language; the store's country's when not given. */
  locale?: EmailLocale;
  /** The store's own text for this message (its customer notification settings). */
  customMessage?: string | null;
  /** The outbox row that sends it: it keeps a retry from sending it twice (lib/sms/delivery.ts). */
  deliveryKey?: string;
}

/**
 * The variables a store's own SMS text may hold: those the dashboard lists
 * ({storeName}, {number}, {startDate}, {endDate}), the customer's first name
 * as the custom email text has it ({name}), and the links and amounts of the
 * messages that carry them ({amount}, {paymentUrl}, {reviewUrl}).
 */
export type StoreSmsVariables = Partial<
  Record<
    | "storeName"
    | "name"
    | "number"
    | "startDate"
    | "endDate"
    | "amount"
    | "paymentUrl"
    | "reviewUrl",
    string
  >
>;

/**
 * The store's own SMS text with its variables filled in, or null when it saved
 * none (the default text then goes). A variable the message does not have is
 * left as written. Like the default texts, it is sent whole: the provider
 * splits a long one into segments, and it counts as one SMS of the quota.
 */
export function renderStoreSmsText(
  text: string | null | undefined,
  values: StoreSmsVariables,
): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const known: Record<string, string | undefined> = values;
  // Own values only: `{constructor}` or `{toString}` is text, not an object's property.
  return trimmed.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(known, name) ? (known[name] ?? placeholder) : placeholder,
  );
}

/** The language of a customer notification SMS: the reservation's, else the store's country's. */
const smsLocale = (store: Store, locale?: EmailLocale) =>
  locale ?? getLocaleFromCountry(store.settings?.country);

/** The variables every customer notification SMS has. */
function reservationSmsVariables(
  { store, customer, reservation }: CustomerNotificationSmsParams,
  locale: EmailLocale,
): StoreSmsVariables {
  return {
    storeName: store.name,
    name: customer.firstName,
    number: reservation.number,
    startDate: formatSmsDate(reservation.startDate, locale),
    endDate: formatSmsDate(reservation.endDate, locale),
  };
}

/**
 * Check SMS quota and determine credit source
 * Returns error result if quota exceeded
 */
async function checkSmsQuotaAndSource(
  storeId: string,
): Promise<
  { allowed: true; creditSource: "plan" | "topup" } | { allowed: false; error: SmsSendResult }
> {
  const quota = await getSmsQuotaStatus(storeId);

  if (!quota.allowed) {
    return {
      allowed: false,
      error: {
        success: false,
        error: "SMS limit reached",
        limitReached: true,
        limitInfo: {
          current: quota.planUsed,
          limit: quota.planLimit ?? 0,
          planSlug: quota.planSlug,
        },
      },
    };
  }

  const creditSource = await determineSmsSource(storeId);
  return { allowed: true, creditSource };
}

/**
 * Build SMS message with character limit awareness
 * Standard SMS: 160 chars, concatenated SMS: 153 chars per segment
 */
function buildSmsMessage(lines: string[]): string {
  return lines.filter(Boolean).join("\n");
}

/**
 * What every SMS to a customer does: the phone, the configuration and the
 * quota, then one delivery. `compose` builds the text once the checks pass.
 */
async function sendToCustomer({
  store,
  customer,
  reservationId,
  templateType,
  compose,
  deliveryKey,
}: {
  store: Store;
  customer: Customer & { id: string };
  reservationId?: string;
  templateType: string;
  compose: () => string;
  deliveryKey?: string;
}): Promise<SmsSendResult> {
  if (!customer.phone) {
    return { success: false, error: "Customer has no phone number" };
  }

  if (!isSmsConfigured()) {
    return { success: false, error: "SMS not configured" };
  }

  // Check SMS quota (includes plan limit + prepaid credits)
  const quotaCheck = await checkSmsQuotaAndSource(store.id);
  if (!quotaCheck.allowed) return quotaCheck.error;

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone);
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || "Invalid phone number format" };
  }

  return deliverSms({
    storeId: store.id,
    reservationId,
    customerId: customer.id,
    to: phoneValidation.normalized,
    message: compose(),
    templateType,
    creditSource: quotaCheck.creditSource,
    sender: "Louez",
    deliveryKey,
  });
}

/**
 * A customer notification SMS: the store's own text when it saved one, else
 * the default of the message's language.
 */
function sendCustomerNotificationSms(
  params: CustomerNotificationSmsParams,
  templateType: string,
  defaultText: (templates: ReturnType<typeof getSmsTemplate>, locale: EmailLocale) => string,
  extraVariables: StoreSmsVariables = {},
): Promise<SmsSendResult> {
  return sendToCustomer({
    store: params.store,
    customer: params.customer,
    reservationId: params.reservation.id,
    templateType,
    deliveryKey: params.deliveryKey,
    compose: () => {
      const locale = smsLocale(params.store, params.locale);
      return (
        renderStoreSmsText(params.customMessage, {
          ...reservationSmsVariables(params, locale),
          ...extraVariables,
        }) ?? defaultText(getSmsTemplate(locale), locale)
      );
    },
  });
}

/**
 * Send instant access link SMS to customer
 *
 * Sends a short SMS with a direct link to access the reservation.
 */
export function sendAccessLinkSms({
  store,
  customer,
  reservation,
  accessUrl,
}: {
  store: Store;
  customer: Customer & { id: string };
  reservation: {
    id: string;
    number: string;
  };
  accessUrl: string;
}): Promise<SmsSendResult> {
  return sendToCustomer({
    store,
    customer,
    reservationId: reservation.id,
    templateType: "instant_access",
    // The store's own action from the dashboard: the language of its country.
    compose: () =>
      getSmsTemplate(getLocaleFromCountry(store.settings?.country)).instant_access({
        storeName: store.name,
        number: reservation.number,
        url: accessUrl,
      }),
  });
}

/**
 * Send reservation confirmation SMS
 */
export function sendReservationConfirmationSms(
  params: CustomerNotificationSmsParams,
): Promise<SmsSendResult> {
  const { store, reservation } = params;
  return sendCustomerNotificationSms(params, "reservation_confirmation", (templates, locale) =>
    templates.reservation_confirmation({
      storeName: store.name,
      number: reservation.number,
      startDate: formatSmsDate(reservation.startDate, locale),
      endDate: formatSmsDate(reservation.endDate, locale),
    }),
  );
}

/**
 * Send pickup reminder SMS
 */
export function sendReminderPickupSms(
  params: CustomerNotificationSmsParams,
): Promise<SmsSendResult> {
  const { store, reservation } = params;
  return sendCustomerNotificationSms(params, "reminder_pickup", (templates, locale) =>
    templates.reminder_pickup({
      storeName: store.name,
      number: reservation.number,
      // With the weekday, for a reminder.
      date: formatSmsDate(reservation.startDate, locale, { weekday: "short" }),
    }),
  );
}

/**
 * Send return reminder SMS
 */
export function sendReminderReturnSms(
  params: CustomerNotificationSmsParams,
): Promise<SmsSendResult> {
  const { store, reservation } = params;
  return sendCustomerNotificationSms(params, "reminder_return", (templates, locale) =>
    templates.reminder_return({
      storeName: store.name,
      number: reservation.number,
      date: formatSmsDate(reservation.endDate, locale, { weekday: "short" }),
    }),
  );
}

/**
 * Send request received SMS
 */
export function sendRequestReceivedSms(
  params: CustomerNotificationSmsParams,
): Promise<SmsSendResult> {
  const { store, reservation } = params;
  return sendCustomerNotificationSms(params, "request_received", (templates) =>
    templates.request_received({ storeName: store.name, number: reservation.number }),
  );
}

/**
 * Send request accepted SMS
 */
export function sendRequestAcceptedSms(
  params: CustomerNotificationSmsParams,
): Promise<SmsSendResult> {
  const { store, reservation } = params;
  return sendCustomerNotificationSms(params, "request_accepted", (templates) =>
    templates.request_accepted({ storeName: store.name, number: reservation.number }),
  );
}

/**
 * Send request rejected SMS
 */
export function sendRequestRejectedSms(
  params: CustomerNotificationSmsParams,
): Promise<SmsSendResult> {
  const { store, reservation } = params;
  return sendCustomerNotificationSms(params, "request_rejected", (templates) =>
    templates.request_rejected({ storeName: store.name, number: reservation.number }),
  );
}

/** The store cancelled the reservation: the customer hears of it (never of a refund). */
export function sendReservationCancelledSms(
  params: CustomerNotificationSmsParams,
): Promise<SmsSendResult> {
  const { store, reservation } = params;
  return sendCustomerNotificationSms(params, "reservation_cancelled", (templates) =>
    templates.reservation_cancelled({ storeName: store.name, number: reservation.number }),
  );
}

/**
 * Send custom SMS message
 */
export function sendCustomSms({
  store,
  customer,
  reservation,
  message,
}: {
  store: Store;
  customer: Customer & { id: string };
  reservation?: {
    id: string;
    number: string;
  };
  message: string;
}): Promise<SmsSendResult> {
  return sendToCustomer({
    store,
    customer,
    reservationId: reservation?.id,
    templateType: "custom",
    compose: () => buildSmsMessage([`${store.name}`, message]),
  });
}

/**
 * Send thank you review request SMS: the store's own text (Review Booster's
 * template) when it saved one.
 */
export function sendThankYouReviewSms({
  store,
  customer,
  reservation,
  reviewUrl,
  customMessage,
  locale = "fr",
}: {
  store: Store;
  customer: Customer & { id: string };
  reservation: {
    id: string;
    number: string;
  };
  reviewUrl: string;
  customMessage?: string | null;
  locale?: EmailLocale;
}): Promise<SmsSendResult> {
  return sendToCustomer({
    store,
    customer,
    reservationId: reservation.id,
    templateType: "thank_you_review",
    compose: () => {
      const own = renderStoreSmsText(customMessage, {
        storeName: store.name,
        name: customer.firstName,
        number: reservation.number,
        reviewUrl,
      });
      if (own) return own;
      const { smsThankYou, smsReview } = getEmailMessages(locale).emails.thankYouReview;
      // Keep message short - SMS are limited to 160 chars
      return buildSmsMessage([`${store.name}`, smsThankYou, `${smsReview} ${reviewUrl}`]);
    },
  });
}

/**
 * Send payment request SMS
 */
export function sendPaymentRequestSms({
  amount,
  paymentUrl,
  currency = "EUR",
  ...params
}: CustomerNotificationSmsParams & {
  amount: number;
  paymentUrl: string;
  currency?: string;
}): Promise<SmsSendResult> {
  const { store, reservation } = params;
  const locale = smsLocale(store, params.locale);
  const formattedAmount = formatSmsAmount(amount, currency, locale);
  return sendCustomerNotificationSms(
    params,
    "payment_request",
    (templates) =>
      templates.payment_request({
        storeName: store.name,
        number: reservation.number,
        amount: formattedAmount,
        url: paymentUrl,
      }),
    { amount: formattedAmount, paymentUrl },
  );
}

/**
 * Send deposit authorization request SMS
 */
export function sendDepositAuthorizationRequestSms({
  depositAmount,
  authorizationUrl,
  currency = "EUR",
  ...params
}: CustomerNotificationSmsParams & {
  depositAmount: number;
  authorizationUrl: string;
  currency?: string;
}): Promise<SmsSendResult> {
  const { store, reservation } = params;
  const locale = smsLocale(store, params.locale);
  const formattedAmount = formatSmsAmount(depositAmount, currency, locale);
  return sendCustomerNotificationSms(
    params,
    "deposit_authorization_request",
    (templates) =>
      templates.deposit_authorization_request({
        storeName: store.name,
        number: reservation.number,
        amount: formattedAmount,
        url: authorizationUrl,
      }),
    // The dashboard's default text names the link {paymentUrl}, as the payment request's.
    { amount: formattedAmount, paymentUrl: authorizationUrl },
  );
}
