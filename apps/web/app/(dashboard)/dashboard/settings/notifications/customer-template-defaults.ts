import type { CustomerNotificationEventType } from "@louez/types";
import type { EmailLocale } from "@/lib/email/i18n";
import { supplementalMessages } from "@/lib/i18n/supplemental-messages";

// Default subjects per event type and locale
export const DEFAULT_SUBJECTS: Record<EmailLocale, Record<CustomerNotificationEventType, string>> = {
  fr: {
    customer_request_received: "Demande de réservation reçue",
    customer_request_accepted: "Votre demande de réservation a été acceptée",
    customer_request_rejected: "Votre demande de réservation n'a pas pu être acceptée",
    customer_reservation_confirmed: "Confirmation de votre réservation #{number}",
    customer_reminder_pickup: "Rappel: retrait de votre réservation demain",
    customer_reminder_return: "Rappel: retour de votre réservation demain",
    customer_payment_requested: "Paiement demandé pour la réservation #{number}",
    customer_deposit_authorization_requested:
      "Autorisation de caution pour la réservation #{number}",
    customer_quote_sent: "Devis pour la réservation #{number}",
    customer_quote_accepted: "Votre devis #{number} a été accepté",
  },
  en: {
    customer_request_received: "Reservation request received",
    customer_request_accepted: "Your reservation request has been accepted",
    customer_request_rejected: "Your reservation request could not be accepted",
    customer_reservation_confirmed: "Confirmation of your reservation #{number}",
    customer_reminder_pickup: "Reminder: pickup of your reservation tomorrow",
    customer_reminder_return: "Reminder: return of your reservation tomorrow",
    customer_payment_requested: "Payment requested for reservation #{number}",
    customer_deposit_authorization_requested: "Deposit authorization for reservation #{number}",
    customer_quote_sent: "Quote for reservation #{number}",
    customer_quote_accepted: "Your quote #{number} has been accepted",
  },
  de: {
    customer_request_received: "Reservierungsanfrage erhalten",
    customer_request_accepted: "Ihre Reservierungsanfrage wurde akzeptiert",
    customer_request_rejected: "Ihre Reservierungsanfrage konnte nicht akzeptiert werden",
    customer_reservation_confirmed: "Bestätigung Ihrer Reservierung #{number}",
    customer_reminder_pickup: "Erinnerung: Abholung Ihrer Reservierung morgen",
    customer_reminder_return: "Erinnerung: Rückgabe Ihrer Reservierung morgen",
    customer_payment_requested: "Zahlung angefordert für Reservierung #{number}",
    customer_deposit_authorization_requested: "Kaution-Autorisierung für Reservierung #{number}",
    customer_quote_sent: "Angebot für Reservierung #{number}",
    customer_quote_accepted: "Ihr Angebot #{number} wurde angenommen",
  },
  es: {
    customer_request_received: "Solicitud de reserva recibida",
    customer_request_accepted: "Su solicitud de reserva ha sido aceptada",
    customer_request_rejected: "Su solicitud de reserva no pudo ser aceptada",
    customer_reservation_confirmed: "Confirmación de su reserva #{number}",
    customer_reminder_pickup: "Recordatorio: recogida de su reserva mañana",
    customer_reminder_return: "Recordatorio: devolución de su reserva mañana",
    customer_payment_requested: "Pago solicitado para la reserva #{number}",
    customer_deposit_authorization_requested: "Autorización de depósito para la reserva #{number}",
    customer_quote_sent: "Presupuesto para la reserva #{number}",
    customer_quote_accepted: "Su presupuesto #{number} ha sido aceptado",
  },
  it: {
    customer_request_received: "Richiesta di prenotazione ricevuta",
    customer_request_accepted: "La tua richiesta di prenotazione è stata accettata",
    customer_request_rejected: "La tua richiesta di prenotazione non è stata accettata",
    customer_reservation_confirmed: "Conferma della tua prenotazione #{number}",
    customer_reminder_pickup: "Promemoria: ritiro della tua prenotazione domani",
    customer_reminder_return: "Promemoria: restituzione della tua prenotazione domani",
    customer_payment_requested: "Pagamento richiesto per la prenotazione #{number}",
    customer_deposit_authorization_requested:
      "Autorizzazione deposito per la prenotazione #{number}",
    customer_quote_sent: "Preventivo per la prenotazione #{number}",
    customer_quote_accepted: "Il tuo preventivo #{number} è stato accettato",
  },
  nl: {
    customer_request_received: "Reserveringsaanvraag ontvangen",
    customer_request_accepted: "Uw reserveringsaanvraag is geaccepteerd",
    customer_request_rejected: "Uw reserveringsaanvraag kon niet worden geaccepteerd",
    customer_reservation_confirmed: "Bevestiging van uw reservering #{number}",
    customer_reminder_pickup: "Herinnering: ophalen van uw reservering morgen",
    customer_reminder_return: "Herinnering: terugbrengen van uw reservering morgen",
    customer_payment_requested: "Betaling gevraagd voor reservering #{number}",
    customer_deposit_authorization_requested: "Borgautorisatie voor reservering #{number}",
    customer_quote_sent: "Offerte voor reservering #{number}",
    customer_quote_accepted: "Uw offerte #{number} is geaccepteerd",
  },
  pl: {
    customer_request_received: "Otrzymano prośbę o rezerwację",
    customer_request_accepted: "Twoja prośba o rezerwację została zaakceptowana",
    customer_request_rejected: "Twoja prośba o rezerwację nie mogła zostać zaakceptowana",
    customer_reservation_confirmed: "Potwierdzenie rezerwacji #{number}",
    customer_reminder_pickup: "Przypomnienie: odbiór rezerwacji jutro",
    customer_reminder_return: "Przypomnienie: zwrot rezerwacji jutro",
    customer_payment_requested: "Płatność wymagana dla rezerwacji #{number}",
    customer_deposit_authorization_requested: "Autoryzacja kaucji dla rezerwacji #{number}",
    customer_quote_sent: "Wycena dla rezerwacji #{number}",
    customer_quote_accepted: "Twoja wycena #{number} została zaakceptowana",
  },
  pt: {
    customer_request_received: "Pedido de reserva recebido",
    customer_request_accepted: "Seu pedido de reserva foi aceito",
    customer_request_rejected: "Seu pedido de reserva não pode ser aceito",
    customer_reservation_confirmed: "Confirmação da sua reserva #{number}",
    customer_reminder_pickup: "Lembrete: retirada da sua reserva amanhã",
    customer_reminder_return: "Lembrete: devolução da sua reserva amanhã",
    customer_payment_requested: "Pagamento solicitado para a reserva #{number}",
    customer_deposit_authorization_requested: "Autorização de caução para a reserva #{number}",
    customer_quote_sent: "Orçamento para a reserva #{number}",
    customer_quote_accepted: "Seu orçamento #{number} foi aceito",
  },

  zh: {
    customer_request_received:
      supplementalMessages.zh.customer_template_modal_DEFAULT_SUBJECTS_customer_request_received,
    customer_request_accepted:
      supplementalMessages.zh.customer_template_modal_DEFAULT_SUBJECTS_customer_request_accepted,
    customer_request_rejected:
      supplementalMessages.zh.customer_template_modal_DEFAULT_SUBJECTS_customer_request_rejected,
    customer_reservation_confirmed:
      supplementalMessages.zh
        .customer_template_modal_DEFAULT_SUBJECTS_customer_reservation_confirmed,
    customer_reminder_pickup:
      supplementalMessages.zh.customer_template_modal_DEFAULT_SUBJECTS_customer_reminder_pickup,
    customer_reminder_return:
      supplementalMessages.zh.customer_template_modal_DEFAULT_SUBJECTS_customer_reminder_return,
    customer_payment_requested:
      supplementalMessages.zh.customer_template_modal_DEFAULT_SUBJECTS_customer_payment_requested,
    customer_deposit_authorization_requested:
      supplementalMessages.zh
        .customer_template_modal_DEFAULT_SUBJECTS_customer_deposit_authorization_requested,
    customer_quote_sent:
      supplementalMessages.zh.customer_template_modal_DEFAULT_SUBJECTS_customer_quote_sent,
    customer_quote_accepted:
      supplementalMessages.zh.customer_template_modal_DEFAULT_SUBJECTS_customer_quote_accepted,
  },
  ja: {
    customer_request_received:
      supplementalMessages.ja.customer_template_modal_DEFAULT_SUBJECTS_customer_request_received,
    customer_request_accepted:
      supplementalMessages.ja.customer_template_modal_DEFAULT_SUBJECTS_customer_request_accepted,
    customer_request_rejected:
      supplementalMessages.ja.customer_template_modal_DEFAULT_SUBJECTS_customer_request_rejected,
    customer_reservation_confirmed:
      supplementalMessages.ja
        .customer_template_modal_DEFAULT_SUBJECTS_customer_reservation_confirmed,
    customer_reminder_pickup:
      supplementalMessages.ja.customer_template_modal_DEFAULT_SUBJECTS_customer_reminder_pickup,
    customer_reminder_return:
      supplementalMessages.ja.customer_template_modal_DEFAULT_SUBJECTS_customer_reminder_return,
    customer_payment_requested:
      supplementalMessages.ja.customer_template_modal_DEFAULT_SUBJECTS_customer_payment_requested,
    customer_deposit_authorization_requested:
      supplementalMessages.ja
        .customer_template_modal_DEFAULT_SUBJECTS_customer_deposit_authorization_requested,
    customer_quote_sent:
      supplementalMessages.ja.customer_template_modal_DEFAULT_SUBJECTS_customer_quote_sent,
    customer_quote_accepted:
      supplementalMessages.ja.customer_template_modal_DEFAULT_SUBJECTS_customer_quote_accepted,
  },
  ru: {
    customer_request_received:
      supplementalMessages.ru.customer_template_modal_DEFAULT_SUBJECTS_customer_request_received,
    customer_request_accepted:
      supplementalMessages.ru.customer_template_modal_DEFAULT_SUBJECTS_customer_request_accepted,
    customer_request_rejected:
      supplementalMessages.ru.customer_template_modal_DEFAULT_SUBJECTS_customer_request_rejected,
    customer_reservation_confirmed:
      supplementalMessages.ru
        .customer_template_modal_DEFAULT_SUBJECTS_customer_reservation_confirmed,
    customer_reminder_pickup:
      supplementalMessages.ru.customer_template_modal_DEFAULT_SUBJECTS_customer_reminder_pickup,
    customer_reminder_return:
      supplementalMessages.ru.customer_template_modal_DEFAULT_SUBJECTS_customer_reminder_return,
    customer_payment_requested:
      supplementalMessages.ru.customer_template_modal_DEFAULT_SUBJECTS_customer_payment_requested,
    customer_deposit_authorization_requested:
      supplementalMessages.ru
        .customer_template_modal_DEFAULT_SUBJECTS_customer_deposit_authorization_requested,
    customer_quote_sent:
      supplementalMessages.ru.customer_template_modal_DEFAULT_SUBJECTS_customer_quote_sent,
    customer_quote_accepted:
      supplementalMessages.ru.customer_template_modal_DEFAULT_SUBJECTS_customer_quote_accepted,
  },
  id: {
    customer_request_received:
      supplementalMessages.id.customer_template_modal_DEFAULT_SUBJECTS_customer_request_received,
    customer_request_accepted:
      supplementalMessages.id.customer_template_modal_DEFAULT_SUBJECTS_customer_request_accepted,
    customer_request_rejected:
      supplementalMessages.id.customer_template_modal_DEFAULT_SUBJECTS_customer_request_rejected,
    customer_reservation_confirmed:
      supplementalMessages.id
        .customer_template_modal_DEFAULT_SUBJECTS_customer_reservation_confirmed,
    customer_reminder_pickup:
      supplementalMessages.id.customer_template_modal_DEFAULT_SUBJECTS_customer_reminder_pickup,
    customer_reminder_return:
      supplementalMessages.id.customer_template_modal_DEFAULT_SUBJECTS_customer_reminder_return,
    customer_payment_requested:
      supplementalMessages.id.customer_template_modal_DEFAULT_SUBJECTS_customer_payment_requested,
    customer_deposit_authorization_requested:
      supplementalMessages.id
        .customer_template_modal_DEFAULT_SUBJECTS_customer_deposit_authorization_requested,
    customer_quote_sent:
      supplementalMessages.id.customer_template_modal_DEFAULT_SUBJECTS_customer_quote_sent,
    customer_quote_accepted:
      supplementalMessages.id.customer_template_modal_DEFAULT_SUBJECTS_customer_quote_accepted,
  },
  ko: {
    customer_request_received:
      supplementalMessages.ko.customer_template_modal_DEFAULT_SUBJECTS_customer_request_received,
    customer_request_accepted:
      supplementalMessages.ko.customer_template_modal_DEFAULT_SUBJECTS_customer_request_accepted,
    customer_request_rejected:
      supplementalMessages.ko.customer_template_modal_DEFAULT_SUBJECTS_customer_request_rejected,
    customer_reservation_confirmed:
      supplementalMessages.ko
        .customer_template_modal_DEFAULT_SUBJECTS_customer_reservation_confirmed,
    customer_reminder_pickup:
      supplementalMessages.ko.customer_template_modal_DEFAULT_SUBJECTS_customer_reminder_pickup,
    customer_reminder_return:
      supplementalMessages.ko.customer_template_modal_DEFAULT_SUBJECTS_customer_reminder_return,
    customer_payment_requested:
      supplementalMessages.ko.customer_template_modal_DEFAULT_SUBJECTS_customer_payment_requested,
    customer_deposit_authorization_requested:
      supplementalMessages.ko
        .customer_template_modal_DEFAULT_SUBJECTS_customer_deposit_authorization_requested,
    customer_quote_sent:
      supplementalMessages.ko.customer_template_modal_DEFAULT_SUBJECTS_customer_quote_sent,
    customer_quote_accepted:
      supplementalMessages.ko.customer_template_modal_DEFAULT_SUBJECTS_customer_quote_accepted,
  },
};

// SMS templates per locale
export const DEFAULT_SMS_TEMPLATES: Record<EmailLocale, Record<CustomerNotificationEventType, string>> = {
  fr: {
    customer_request_received:
      "{storeName}\nDemande reçue #{number}\nNous reviendrons vers vous rapidement.",
    customer_request_accepted: "{storeName}\nDemande #{number} acceptée!\nRetrait le {startDate}",
    customer_request_rejected:
      "{storeName}\nDemande #{number} non disponible.\nContactez-nous pour plus d'infos.",
    customer_reservation_confirmed:
      "{storeName}\nRéservation #{number} confirmée\nDu {startDate} au {endDate}",
    customer_reminder_pickup: "{storeName}\nRappel: retrait demain\nRéservation #{number}",
    customer_reminder_return: "{storeName}\nRappel: retour demain\nRéservation #{number}",
    customer_payment_requested:
      "{storeName}\nPaiement de {amount} demandé pour #{number}\n{paymentUrl}",
    customer_deposit_authorization_requested:
      "{storeName}\nCaution de {amount} à autoriser pour #{number}\n{paymentUrl}",
    customer_quote_sent:
      "{storeName}\nDevis #{number} reçu\nConsultez-le depuis votre espace client.",
    customer_quote_accepted: "{storeName}\nDevis #{number} accepté!\nRetrait le {startDate}",
  },
  en: {
    customer_request_received:
      "{storeName}\nRequest received #{number}\nWe will get back to you shortly.",
    customer_request_accepted: "{storeName}\nRequest #{number} accepted!\nPickup on {startDate}",
    customer_request_rejected:
      "{storeName}\nRequest #{number} unavailable.\nContact us for more info.",
    customer_reservation_confirmed:
      "{storeName}\nReservation #{number} confirmed\nFrom {startDate} to {endDate}",
    customer_reminder_pickup: "{storeName}\nReminder: pickup tomorrow\nReservation #{number}",
    customer_reminder_return: "{storeName}\nReminder: return tomorrow\nReservation #{number}",
    customer_payment_requested:
      "{storeName}\nPayment of {amount} requested for #{number}\n{paymentUrl}",
    customer_deposit_authorization_requested:
      "{storeName}\nDeposit of {amount} to authorize for #{number}\n{paymentUrl}",
    customer_quote_sent: "{storeName}\nQuote #{number} received\nView it from your account.",
    customer_quote_accepted: "{storeName}\nQuote #{number} accepted!\nPickup on {startDate}",
  },
  de: {
    customer_request_received: "{storeName}\nAnfrage erhalten #{number}\nWir melden uns in Kürze.",
    customer_request_accepted:
      "{storeName}\nAnfrage #{number} akzeptiert!\nAbholung am {startDate}",
    customer_request_rejected:
      "{storeName}\nAnfrage #{number} nicht verfügbar.\nKontaktieren Sie uns.",
    customer_reservation_confirmed:
      "{storeName}\nReservierung #{number} bestätigt\nVom {startDate} bis {endDate}",
    customer_reminder_pickup: "{storeName}\nErinnerung: Abholung morgen\nReservierung #{number}",
    customer_reminder_return: "{storeName}\nErinnerung: Rückgabe morgen\nReservierung #{number}",
    customer_payment_requested:
      "{storeName}\nZahlung von {amount} für #{number} angefordert\n{paymentUrl}",
    customer_deposit_authorization_requested:
      "{storeName}\nKaution von {amount} für #{number} freizugeben\n{paymentUrl}",
    customer_quote_sent:
      "{storeName}\nAngebot #{number} erhalten\nSehen Sie es in Ihrem Konto ein.",
    customer_quote_accepted: "{storeName}\nAngebot #{number} angenommen!\nAbholung am {startDate}",
  },
  es: {
    customer_request_received:
      "{storeName}\nSolicitud recibida #{number}\nLe responderemos pronto.",
    customer_request_accepted:
      "{storeName}\nSolicitud #{number} aceptada!\nRecogida el {startDate}",
    customer_request_rejected:
      "{storeName}\nSolicitud #{number} no disponible.\nContáctenos para más info.",
    customer_reservation_confirmed:
      "{storeName}\nReserva #{number} confirmada\nDel {startDate} al {endDate}",
    customer_reminder_pickup: "{storeName}\nRecordatorio: recogida mañana\nReserva #{number}",
    customer_reminder_return: "{storeName}\nRecordatorio: devolución mañana\nReserva #{number}",
    customer_payment_requested:
      "{storeName}\nPago de {amount} solicitado para #{number}\n{paymentUrl}",
    customer_deposit_authorization_requested:
      "{storeName}\nDepósito de {amount} a autorizar para #{number}\n{paymentUrl}",
    customer_quote_sent: "{storeName}\nPresupuesto #{number} recibido\nConsúltelo desde su cuenta.",
    customer_quote_accepted:
      "{storeName}\nPresupuesto #{number} aceptado!\nRecogida el {startDate}",
  },
  it: {
    customer_request_received: "{storeName}\nRichiesta ricevuta #{number}\nTi risponderemo presto.",
    customer_request_accepted: "{storeName}\nRichiesta #{number} accettata!\nRitiro il {startDate}",
    customer_request_rejected:
      "{storeName}\nRichiesta #{number} non disponibile.\nContattaci per info.",
    customer_reservation_confirmed:
      "{storeName}\nPrenotazione #{number} confermata\nDal {startDate} al {endDate}",
    customer_reminder_pickup: "{storeName}\nPromemoria: ritiro domani\nPrenotazione #{number}",
    customer_reminder_return:
      "{storeName}\nPromemoria: restituzione domani\nPrenotazione #{number}",
    customer_payment_requested:
      "{storeName}\nPagamento di {amount} richiesto per #{number}\n{paymentUrl}",
    customer_deposit_authorization_requested:
      "{storeName}\nDeposito di {amount} da autorizzare per #{number}\n{paymentUrl}",
    customer_quote_sent: "{storeName}\nPreventivo #{number} ricevuto\nConsultalo dal tuo account.",
    customer_quote_accepted: "{storeName}\nPreventivo #{number} accettato!\nRitiro il {startDate}",
  },
  nl: {
    customer_request_received:
      "{storeName}\nAanvraag ontvangen #{number}\nWe nemen snel contact op.",
    customer_request_accepted:
      "{storeName}\nAanvraag #{number} geaccepteerd!\nOphalen op {startDate}",
    customer_request_rejected:
      "{storeName}\nAanvraag #{number} niet beschikbaar.\nNeem contact op.",
    customer_reservation_confirmed:
      "{storeName}\nReservering #{number} bevestigd\nVan {startDate} tot {endDate}",
    customer_reminder_pickup: "{storeName}\nHerinnering: ophalen morgen\nReservering #{number}",
    customer_reminder_return:
      "{storeName}\nHerinnering: terugbrengen morgen\nReservering #{number}",
    customer_payment_requested:
      "{storeName}\nBetaling van {amount} gevraagd voor #{number}\n{paymentUrl}",
    customer_deposit_authorization_requested:
      "{storeName}\nBorg van {amount} te autoriseren voor #{number}\n{paymentUrl}",
    customer_quote_sent: "{storeName}\nOfferte #{number} ontvangen\nBekijk het in uw account.",
    customer_quote_accepted: "{storeName}\nOfferte #{number} geaccepteerd!\nOphalen op {startDate}",
  },
  pl: {
    customer_request_received: "{storeName}\nProśba otrzymana #{number}\nOdezwiemy się wkrótce.",
    customer_request_accepted: "{storeName}\nProśba #{number} zaakceptowana!\nOdbiór {startDate}",
    customer_request_rejected: "{storeName}\nProśba #{number} niedostępna.\nSkontaktuj się z nami.",
    customer_reservation_confirmed:
      "{storeName}\nRezerwacja #{number} potwierdzona\nOd {startDate} do {endDate}",
    customer_reminder_pickup: "{storeName}\nPrzypomnienie: odbiór jutro\nRezerwacja #{number}",
    customer_reminder_return: "{storeName}\nPrzypomnienie: zwrot jutro\nRezerwacja #{number}",
    customer_payment_requested:
      "{storeName}\nPłatność {amount} wymagana dla #{number}\n{paymentUrl}",
    customer_deposit_authorization_requested:
      "{storeName}\nKaucja {amount} do autoryzacji dla #{number}\n{paymentUrl}",
    customer_quote_sent: "{storeName}\nWycena #{number} otrzymana\nSprawdź ją na swoim koncie.",
    customer_quote_accepted: "{storeName}\nWycena #{number} zaakceptowana!\nOdbiór {startDate}",
  },
  pt: {
    customer_request_received:
      "{storeName}\nPedido recebido #{number}\nEntraremos em contato em breve.",
    customer_request_accepted: "{storeName}\nPedido #{number} aceito!\nRetirada em {startDate}",
    customer_request_rejected: "{storeName}\nPedido #{number} indisponível.\nEntre em contato.",
    customer_reservation_confirmed:
      "{storeName}\nReserva #{number} confirmada\nDe {startDate} a {endDate}",
    customer_reminder_pickup: "{storeName}\nLembrete: retirada amanhã\nReserva #{number}",
    customer_reminder_return: "{storeName}\nLembrete: devolução amanhã\nReserva #{number}",
    customer_payment_requested:
      "{storeName}\nPagamento de {amount} solicitado para #{number}\n{paymentUrl}",
    customer_deposit_authorization_requested:
      "{storeName}\nCaução de {amount} a autorizar para #{number}\n{paymentUrl}",
    customer_quote_sent: "{storeName}\nOrçamento #{number} recebido\nConsulte-o na sua conta.",
    customer_quote_accepted: "{storeName}\nOrçamento #{number} aceito!\nRetirada em {startDate}",
  },

  zh: {
    customer_request_received:
      supplementalMessages.zh
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_received,
    customer_request_accepted:
      supplementalMessages.zh
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_accepted,
    customer_request_rejected:
      supplementalMessages.zh
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_rejected,
    customer_reservation_confirmed:
      supplementalMessages.zh
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reservation_confirmed,
    customer_reminder_pickup:
      supplementalMessages.zh
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reminder_pickup,
    customer_reminder_return:
      supplementalMessages.zh
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reminder_return,
    customer_payment_requested:
      supplementalMessages.zh
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_payment_requested,
    customer_deposit_authorization_requested:
      supplementalMessages.zh
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_deposit_authorization_requested,
    customer_quote_sent:
      supplementalMessages.zh.customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_quote_sent,
    customer_quote_accepted:
      supplementalMessages.zh.customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_quote_accepted,
  },
  ja: {
    customer_request_received:
      supplementalMessages.ja
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_received,
    customer_request_accepted:
      supplementalMessages.ja
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_accepted,
    customer_request_rejected:
      supplementalMessages.ja
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_rejected,
    customer_reservation_confirmed:
      supplementalMessages.ja
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reservation_confirmed,
    customer_reminder_pickup:
      supplementalMessages.ja
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reminder_pickup,
    customer_reminder_return:
      supplementalMessages.ja
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reminder_return,
    customer_payment_requested:
      supplementalMessages.ja
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_payment_requested,
    customer_deposit_authorization_requested:
      supplementalMessages.ja
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_deposit_authorization_requested,
    customer_quote_sent:
      supplementalMessages.ja.customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_quote_sent,
    customer_quote_accepted:
      supplementalMessages.ja.customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_quote_accepted,
  },
  ru: {
    customer_request_received:
      supplementalMessages.ru
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_received,
    customer_request_accepted:
      supplementalMessages.ru
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_accepted,
    customer_request_rejected:
      supplementalMessages.ru
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_rejected,
    customer_reservation_confirmed:
      supplementalMessages.ru
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reservation_confirmed,
    customer_reminder_pickup:
      supplementalMessages.ru
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reminder_pickup,
    customer_reminder_return:
      supplementalMessages.ru
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reminder_return,
    customer_payment_requested:
      supplementalMessages.ru
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_payment_requested,
    customer_deposit_authorization_requested:
      supplementalMessages.ru
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_deposit_authorization_requested,
    customer_quote_sent:
      supplementalMessages.ru.customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_quote_sent,
    customer_quote_accepted:
      supplementalMessages.ru.customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_quote_accepted,
  },
  id: {
    customer_request_received:
      supplementalMessages.id
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_received,
    customer_request_accepted:
      supplementalMessages.id
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_accepted,
    customer_request_rejected:
      supplementalMessages.id
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_rejected,
    customer_reservation_confirmed:
      supplementalMessages.id
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reservation_confirmed,
    customer_reminder_pickup:
      supplementalMessages.id
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reminder_pickup,
    customer_reminder_return:
      supplementalMessages.id
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reminder_return,
    customer_payment_requested:
      supplementalMessages.id
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_payment_requested,
    customer_deposit_authorization_requested:
      supplementalMessages.id
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_deposit_authorization_requested,
    customer_quote_sent:
      supplementalMessages.id.customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_quote_sent,
    customer_quote_accepted:
      supplementalMessages.id.customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_quote_accepted,
  },
  ko: {
    customer_request_received:
      supplementalMessages.ko
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_received,
    customer_request_accepted:
      supplementalMessages.ko
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_accepted,
    customer_request_rejected:
      supplementalMessages.ko
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_request_rejected,
    customer_reservation_confirmed:
      supplementalMessages.ko
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reservation_confirmed,
    customer_reminder_pickup:
      supplementalMessages.ko
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reminder_pickup,
    customer_reminder_return:
      supplementalMessages.ko
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_reminder_return,
    customer_payment_requested:
      supplementalMessages.ko
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_payment_requested,
    customer_deposit_authorization_requested:
      supplementalMessages.ko
        .customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_deposit_authorization_requested,
    customer_quote_sent:
      supplementalMessages.ko.customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_quote_sent,
    customer_quote_accepted:
      supplementalMessages.ko.customer_template_modal_DEFAULT_SMS_TEMPLATES_customer_quote_accepted,
  },
};
