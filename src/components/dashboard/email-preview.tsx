'use client'

import { useMemo } from 'react'
import { format, type Locale } from 'date-fns'
import { fr, enUS, de, es, it, nl, pl, pt } from 'date-fns/locale'
import type { EmailLocale } from '@/lib/email/i18n'

const DATE_LOCALES: Record<EmailLocale, Locale> = {
  fr,
  en: enUS,
  de,
  es,
  it,
  nl,
  pl,
  pt,
}

interface EmailPreviewProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeEmail?: string | null
  storePhone?: string | null
  storeAddress?: string | null
  locale: EmailLocale
  subject: string
  title: string
  greeting: string
  bodyContent: React.ReactNode
  additionalMessage?: string
  ctaButton?: {
    text: string
    url?: string
  }
  footerNote?: string
}

/**
 * Full email preview with complete email client simulation
 */
export function EmailPreview({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeEmail,
  storePhone,
  storeAddress,
  locale,
  subject,
  title,
  greeting,
  bodyContent,
  additionalMessage,
  ctaButton,
  footerNote,
}: EmailPreviewProps) {
  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden">
      {/* Email client header */}
      <div className="bg-muted/50 px-4 py-3 border-b">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-yellow-400" />
            <div className="w-3 h-3 rounded-full bg-green-400" />
          </div>
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex gap-2">
            <span className="text-muted-foreground w-12">De:</span>
            <span className="font-medium">
              {storeName} &lt;{storeEmail || 'noreply@louez.io'}&gt;
            </span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-12">Objet:</span>
            <span className="font-medium truncate">{subject}</span>
          </div>
        </div>
      </div>

      {/* Email content */}
      <div className="bg-[#f6f9fc] p-4">
        <div className="bg-white rounded-lg shadow-sm max-w-[500px] mx-auto overflow-hidden">
          {/* Header */}
          <div
            className="p-6 text-center bg-muted/30"
            style={{ borderBottom: `3px solid ${primaryColor}` }}
          >
            {logoUrl ? (
              <img src={logoUrl} alt={storeName} className="h-10 mx-auto object-contain" />
            ) : (
              <span className="text-xl font-bold" style={{ color: primaryColor }}>
                {storeName}
              </span>
            )}
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-600">{greeting}</p>
            <div className="text-sm text-gray-600 space-y-3">{bodyContent}</div>

            {additionalMessage && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mt-4">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{additionalMessage}</p>
              </div>
            )}

            {ctaButton && (
              <div className="text-center py-4">
                <span
                  className="inline-block px-6 py-3 rounded-md text-sm font-bold text-white"
                  style={{ backgroundColor: primaryColor }}
                >
                  {ctaButton.text}
                </span>
              </div>
            )}

            {footerNote && (
              <p className="text-xs text-gray-400 text-center italic pt-2">{footerNote}</p>
            )}
          </div>

          {/* Footer */}
          <div className="bg-muted/30 p-4 border-t text-center">
            <p className="text-xs font-medium text-gray-700">{storeName}</p>
            {storeAddress && <p className="text-xs text-gray-500">{storeAddress}</p>}
            {storeEmail && <p className="text-xs text-gray-500">{storeEmail}</p>}
            <p className="text-[10px] text-gray-400 mt-3">
              Propulsé par <span className="text-primary font-medium">Louez.io</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Compact Email Preview
// ============================================================================

interface EmailPreviewCompactProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  subject: string
  additionalMessage?: string
  locale: EmailLocale
  eventType: string
  customerName: string
  reservationNumber: string
  startDate: Date
  endDate: Date
}

/**
 * Compact email preview - simplified view for the sheet
 */
export function EmailPreviewCompact({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  subject,
  additionalMessage,
  locale,
  eventType,
  customerName,
  reservationNumber,
  startDate,
  endDate,
}: EmailPreviewCompactProps) {
  const dateLocale = DATE_LOCALES[locale] || fr

  const content = useMemo(() => {
    const formattedStartDate = format(startDate, 'PPP', { locale: dateLocale })
    const formattedEndDate = format(endDate, 'PPP', { locale: dateLocale })

    const titles: Record<string, Record<EmailLocale, string>> = {
      customer_request_received: {
        fr: 'Demande de réservation reçue',
        en: 'Reservation request received',
        de: 'Reservierungsanfrage erhalten',
        es: 'Solicitud de reserva recibida',
        it: 'Richiesta di prenotazione ricevuta',
        nl: 'Reserveringsaanvraag ontvangen',
        pl: 'Otrzymano prośbę o rezerwację',
        pt: 'Pedido de reserva recebido',
      },
      customer_request_accepted: {
        fr: 'Demande acceptée !',
        en: 'Request accepted!',
        de: 'Anfrage akzeptiert!',
        es: '¡Solicitud aceptada!',
        it: 'Richiesta accettata!',
        nl: 'Aanvraag geaccepteerd!',
        pl: 'Prośba zaakceptowana!',
        pt: 'Pedido aceito!',
      },
      customer_request_rejected: {
        fr: 'Demande non disponible',
        en: 'Request unavailable',
        de: 'Anfrage nicht verfügbar',
        es: 'Solicitud no disponible',
        it: 'Richiesta non disponibile',
        nl: 'Aanvraag niet beschikbaar',
        pl: 'Prośba niedostępna',
        pt: 'Pedido não disponível',
      },
      customer_reservation_confirmed: {
        fr: 'Réservation confirmée',
        en: 'Reservation confirmed',
        de: 'Reservierung bestätigt',
        es: 'Reserva confirmada',
        it: 'Prenotazione confermata',
        nl: 'Reservering bevestigd',
        pl: 'Rezerwacja potwierdzona',
        pt: 'Reserva confirmada',
      },
      customer_reminder_pickup: {
        fr: 'Rappel: retrait demain',
        en: 'Reminder: pickup tomorrow',
        de: 'Erinnerung: Abholung morgen',
        es: 'Recordatorio: recogida mañana',
        it: 'Promemoria: ritiro domani',
        nl: 'Herinnering: ophalen morgen',
        pl: 'Przypomnienie: odbiór jutro',
        pt: 'Lembrete: retirada amanhã',
      },
      customer_reminder_return: {
        fr: 'Rappel: retour demain',
        en: 'Reminder: return tomorrow',
        de: 'Erinnerung: Rückgabe morgen',
        es: 'Recordatorio: devolución mañana',
        it: 'Promemoria: restituzione domani',
        nl: 'Herinnering: terugbrengen morgen',
        pl: 'Przypomnienie: zwrot jutro',
        pt: 'Lembrete: devolução amanhã',
      },
      thank_you_review: {
        fr: 'Merci pour votre location !',
        en: 'Thank you for your rental!',
        de: 'Vielen Dank für Ihre Miete!',
        es: '¡Gracias por su alquiler!',
        it: 'Grazie per il tuo noleggio!',
        nl: 'Bedankt voor uw verhuur!',
        pl: 'Dziękujemy za wynajem!',
        pt: 'Obrigado pelo seu aluguel!',
      },
    }

    const greetings: Record<EmailLocale, string> = {
      fr: `Bonjour ${customerName},`,
      en: `Hello ${customerName},`,
      de: `Hallo ${customerName},`,
      es: `Hola ${customerName},`,
      it: `Ciao ${customerName},`,
      nl: `Hallo ${customerName},`,
      pl: `Cześć ${customerName},`,
      pt: `Olá ${customerName},`,
    }

    const reservationInfo: Record<EmailLocale, string> = {
      fr: `Réservation #${reservationNumber} • Du ${formattedStartDate} au ${formattedEndDate}`,
      en: `Reservation #${reservationNumber} • From ${formattedStartDate} to ${formattedEndDate}`,
      de: `Reservierung #${reservationNumber} • Vom ${formattedStartDate} bis ${formattedEndDate}`,
      es: `Reserva #${reservationNumber} • Del ${formattedStartDate} al ${formattedEndDate}`,
      it: `Prenotazione #${reservationNumber} • Dal ${formattedStartDate} al ${formattedEndDate}`,
      nl: `Reservering #${reservationNumber} • Van ${formattedStartDate} tot ${formattedEndDate}`,
      pl: `Rezerwacja #${reservationNumber} • Od ${formattedStartDate} do ${formattedEndDate}`,
      pt: `Reserva #${reservationNumber} • De ${formattedStartDate} a ${formattedEndDate}`,
    }

    return {
      title: titles[eventType]?.[locale] || titles['customer_request_received'][locale],
      greeting: greetings[locale],
      reservationInfo: reservationInfo[locale],
    }
  }, [eventType, locale, customerName, reservationNumber, startDate, endDate, dateLocale])

  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden">
      {/* Compact header */}
      <div className="bg-muted/50 px-4 py-2.5 border-b">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Objet:</span>
          <span className="font-medium truncate">{subject}</span>
        </div>
      </div>

      {/* Simplified email body */}
      <div className="p-4">
        <div className="bg-white rounded-lg border overflow-hidden">
          {/* Logo header */}
          <div
            className="px-4 py-3 text-center"
            style={{ borderBottom: `2px solid ${primaryColor}` }}
          >
            {logoUrl ? (
              <img src={logoUrl} alt={storeName} className="h-6 mx-auto object-contain" />
            ) : (
              <span className="text-sm font-bold" style={{ color: primaryColor }}>
                {storeName}
              </span>
            )}
          </div>

          {/* Content */}
          <div className="p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">{content.title}</h3>
            <p className="text-xs text-gray-600">{content.greeting}</p>

            {/* Reservation info box */}
            <div className="bg-gray-50 rounded-md px-3 py-2">
              <p className="text-xs text-gray-600">{content.reservationInfo}</p>
            </div>

            {/* Additional message preview */}
            {additionalMessage && (
              <div className="bg-blue-50 border border-blue-100 rounded-md px-3 py-2">
                <p className="text-xs text-gray-700 whitespace-pre-wrap line-clamp-3">
                  {additionalMessage}
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-4 py-2 border-t text-center">
            <p className="text-[10px] text-gray-400">
              {storeName} • Propulsé par Louez.io
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Full Event Email Preview (kept for compatibility)
// ============================================================================

interface EventEmailPreviewProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeEmail?: string | null
  storePhone?: string | null
  storeAddress?: string | null
  locale: EmailLocale
  customerName: string
  reservationNumber: string
  startDate: Date
  endDate: Date
  subject: string
  additionalMessage?: string
  eventType: string
}

export function EventEmailPreview(props: EventEmailPreviewProps) {
  const {
    storeName,
    logoUrl,
    primaryColor,
    storeEmail,
    storePhone,
    storeAddress,
    locale,
    customerName,
    reservationNumber,
    startDate,
    endDate,
    subject,
    additionalMessage,
    eventType,
  } = props

  const dateLocale = DATE_LOCALES[locale] || fr

  const content = useMemo(() => {
    const formattedStartDate = format(startDate, 'PPP', { locale: dateLocale })
    const formattedEndDate = format(endDate, 'PPP', { locale: dateLocale })

    const titles: Record<string, Record<EmailLocale, string>> = {
      customer_request_received: {
        fr: 'Demande de réservation reçue',
        en: 'Reservation request received',
        de: 'Reservierungsanfrage erhalten',
        es: 'Solicitud de reserva recibida',
        it: 'Richiesta di prenotazione ricevuta',
        nl: 'Reserveringsaanvraag ontvangen',
        pl: 'Otrzymano prośbę o rezerwację',
        pt: 'Pedido de reserva recebido',
      },
      customer_request_accepted: {
        fr: 'Demande acceptée !',
        en: 'Request accepted!',
        de: 'Anfrage akzeptiert!',
        es: '¡Solicitud aceptada!',
        it: 'Richiesta accettata!',
        nl: 'Aanvraag geaccepteerd!',
        pl: 'Prośba zaakceptowana!',
        pt: 'Pedido aceito!',
      },
      customer_request_rejected: {
        fr: 'Demande non disponible',
        en: 'Request unavailable',
        de: 'Anfrage nicht verfügbar',
        es: 'Solicitud no disponible',
        it: 'Richiesta non disponibile',
        nl: 'Aanvraag niet beschikbaar',
        pl: 'Prośba niedostępna',
        pt: 'Pedido não disponível',
      },
      customer_reservation_confirmed: {
        fr: 'Réservation confirmée',
        en: 'Reservation confirmed',
        de: 'Reservierung bestätigt',
        es: 'Reserva confirmada',
        it: 'Prenotazione confermata',
        nl: 'Reservering bevestigd',
        pl: 'Rezerwacja potwierdzona',
        pt: 'Reserva confirmada',
      },
      customer_reminder_pickup: {
        fr: 'Rappel: retrait demain',
        en: 'Reminder: pickup tomorrow',
        de: 'Erinnerung: Abholung morgen',
        es: 'Recordatorio: recogida mañana',
        it: 'Promemoria: ritiro domani',
        nl: 'Herinnering: ophalen morgen',
        pl: 'Przypomnienie: odbiór jutro',
        pt: 'Lembrete: retirada amanhã',
      },
      customer_reminder_return: {
        fr: 'Rappel: retour demain',
        en: 'Reminder: return tomorrow',
        de: 'Erinnerung: Rückgabe morgen',
        es: 'Recordatorio: devolución mañana',
        it: 'Promemoria: restituzione domani',
        nl: 'Herinnering: terugbrengen morgen',
        pl: 'Przypomnienie: zwrot jutro',
        pt: 'Lembrete: devolução amanhã',
      },
      thank_you_review: {
        fr: 'Merci pour votre location !',
        en: 'Thank you for your rental!',
        de: 'Vielen Dank für Ihre Miete!',
        es: '¡Gracias por su alquiler!',
        it: 'Grazie per il tuo noleggio!',
        nl: 'Bedankt voor uw verhuur!',
        pl: 'Dziękujemy za wynajem!',
        pt: 'Obrigado pelo seu aluguel!',
      },
    }

    const greetings: Record<EmailLocale, string> = {
      fr: `Bonjour ${customerName},`,
      en: `Hello ${customerName},`,
      de: `Hallo ${customerName},`,
      es: `Hola ${customerName},`,
      it: `Ciao ${customerName},`,
      nl: `Hallo ${customerName},`,
      pl: `Cześć ${customerName},`,
      pt: `Olá ${customerName},`,
    }

    const defaultBody: Record<EmailLocale, React.ReactNode> = {
      fr: (
        <div className="bg-gray-100 rounded-lg p-4 my-3">
          <p className="font-medium text-gray-900">Réservation #{reservationNumber}</p>
          <p className="text-gray-600">
            Du {formattedStartDate} au {formattedEndDate}
          </p>
        </div>
      ),
      en: (
        <div className="bg-gray-100 rounded-lg p-4 my-3">
          <p className="font-medium text-gray-900">Reservation #{reservationNumber}</p>
          <p className="text-gray-600">
            From {formattedStartDate} to {formattedEndDate}
          </p>
        </div>
      ),
      de: (
        <div className="bg-gray-100 rounded-lg p-4 my-3">
          <p className="font-medium text-gray-900">Reservierung #{reservationNumber}</p>
          <p className="text-gray-600">
            Vom {formattedStartDate} bis {formattedEndDate}
          </p>
        </div>
      ),
      es: (
        <div className="bg-gray-100 rounded-lg p-4 my-3">
          <p className="font-medium text-gray-900">Reserva #{reservationNumber}</p>
          <p className="text-gray-600">
            Del {formattedStartDate} al {formattedEndDate}
          </p>
        </div>
      ),
      it: (
        <div className="bg-gray-100 rounded-lg p-4 my-3">
          <p className="font-medium text-gray-900">Prenotazione #{reservationNumber}</p>
          <p className="text-gray-600">
            Dal {formattedStartDate} al {formattedEndDate}
          </p>
        </div>
      ),
      nl: (
        <div className="bg-gray-100 rounded-lg p-4 my-3">
          <p className="font-medium text-gray-900">Reservering #{reservationNumber}</p>
          <p className="text-gray-600">
            Van {formattedStartDate} tot {formattedEndDate}
          </p>
        </div>
      ),
      pl: (
        <div className="bg-gray-100 rounded-lg p-4 my-3">
          <p className="font-medium text-gray-900">Rezerwacja #{reservationNumber}</p>
          <p className="text-gray-600">
            Od {formattedStartDate} do {formattedEndDate}
          </p>
        </div>
      ),
      pt: (
        <div className="bg-gray-100 rounded-lg p-4 my-3">
          <p className="font-medium text-gray-900">Reserva #{reservationNumber}</p>
          <p className="text-gray-600">
            De {formattedStartDate} a {formattedEndDate}
          </p>
        </div>
      ),
    }

    return {
      title: titles[eventType]?.[locale] || titles['customer_request_received'][locale],
      greeting: greetings[locale],
      body: defaultBody[locale],
    }
  }, [eventType, locale, customerName, reservationNumber, startDate, endDate, dateLocale])

  return (
    <EmailPreview
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      storeAddress={storeAddress}
      locale={locale}
      subject={subject}
      title={content.title}
      greeting={content.greeting}
      bodyContent={content.body}
      additionalMessage={additionalMessage}
    />
  )
}
