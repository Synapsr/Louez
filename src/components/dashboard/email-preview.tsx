'use client'

import { useMemo } from 'react'
import { format, type Locale } from 'date-fns'
import { fr, enUS, de, es, it, nl, pl, pt } from 'date-fns/locale'
import type { EmailLocale } from '@/lib/email/i18n'

interface EmailPreviewProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeEmail?: string | null
  storePhone?: string | null
  storeAddress?: string | null
  locale: EmailLocale
  // Content
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
  const dateLocale = DATE_LOCALES[locale] || fr

  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden">
      {/* Email client header simulation */}
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
            <span className="font-medium">{storeName} &lt;{storeEmail || 'noreply@louez.io'}&gt;</span>
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
              <img
                src={logoUrl}
                alt={storeName}
                className="h-10 mx-auto object-contain"
              />
            ) : (
              <span
                className="text-xl font-bold"
                style={{ color: primaryColor }}
              >
                {storeName}
              </span>
            )}
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>

            <p className="text-sm text-gray-600">{greeting}</p>

            <div className="text-sm text-gray-600 space-y-3">
              {bodyContent}
            </div>

            {/* Additional custom message */}
            {additionalMessage && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mt-4">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {additionalMessage}
                </p>
              </div>
            )}

            {/* CTA Button */}
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

            {/* Footer note */}
            {footerNote && (
              <p className="text-xs text-gray-400 text-center italic pt-2">
                {footerNote}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="bg-muted/30 p-4 border-t text-center">
            <p className="text-xs font-medium text-gray-700">{storeName}</p>
            {storeAddress && (
              <p className="text-xs text-gray-500">{storeAddress}</p>
            )}
            {storeEmail && (
              <p className="text-xs text-gray-500">{storeEmail}</p>
            )}
            <p className="text-[10px] text-gray-400 mt-3">
              Propulsé par{' '}
              <span className="text-primary font-medium">Louez.io</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// Simplified preview for specific event types
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

  // Localized content based on event type
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

    const bodies: Record<string, Record<EmailLocale, React.ReactNode>> = {
      customer_request_received: {
        fr: (
          <>
            <p>Nous avons bien reçu votre demande de réservation.</p>
            <div className="bg-gray-100 rounded-lg p-4 my-3">
              <p className="font-medium text-gray-900">Réservation #{reservationNumber}</p>
              <p className="text-gray-600">Du {formattedStartDate} au {formattedEndDate}</p>
            </div>
            <p>Nous examinons votre demande et reviendrons vers vous rapidement.</p>
          </>
        ),
        en: (
          <>
            <p>We have received your reservation request.</p>
            <div className="bg-gray-100 rounded-lg p-4 my-3">
              <p className="font-medium text-gray-900">Reservation #{reservationNumber}</p>
              <p className="text-gray-600">From {formattedStartDate} to {formattedEndDate}</p>
            </div>
            <p>We are reviewing your request and will get back to you shortly.</p>
          </>
        ),
        de: (
          <>
            <p>Wir haben Ihre Reservierungsanfrage erhalten.</p>
            <div className="bg-gray-100 rounded-lg p-4 my-3">
              <p className="font-medium text-gray-900">Reservierung #{reservationNumber}</p>
              <p className="text-gray-600">Vom {formattedStartDate} bis {formattedEndDate}</p>
            </div>
            <p>Wir prüfen Ihre Anfrage und melden uns in Kürze.</p>
          </>
        ),
        es: (
          <>
            <p>Hemos recibido su solicitud de reserva.</p>
            <div className="bg-gray-100 rounded-lg p-4 my-3">
              <p className="font-medium text-gray-900">Reserva #{reservationNumber}</p>
              <p className="text-gray-600">Del {formattedStartDate} al {formattedEndDate}</p>
            </div>
            <p>Estamos revisando su solicitud y le responderemos pronto.</p>
          </>
        ),
        it: (
          <>
            <p>Abbiamo ricevuto la tua richiesta di prenotazione.</p>
            <div className="bg-gray-100 rounded-lg p-4 my-3">
              <p className="font-medium text-gray-900">Prenotazione #{reservationNumber}</p>
              <p className="text-gray-600">Dal {formattedStartDate} al {formattedEndDate}</p>
            </div>
            <p>Stiamo esaminando la tua richiesta e ti risponderemo a breve.</p>
          </>
        ),
        nl: (
          <>
            <p>We hebben uw reserveringsaanvraag ontvangen.</p>
            <div className="bg-gray-100 rounded-lg p-4 my-3">
              <p className="font-medium text-gray-900">Reservering #{reservationNumber}</p>
              <p className="text-gray-600">Van {formattedStartDate} tot {formattedEndDate}</p>
            </div>
            <p>We bekijken uw aanvraag en nemen snel contact met u op.</p>
          </>
        ),
        pl: (
          <>
            <p>Otrzymaliśmy Twoją prośbę o rezerwację.</p>
            <div className="bg-gray-100 rounded-lg p-4 my-3">
              <p className="font-medium text-gray-900">Rezerwacja #{reservationNumber}</p>
              <p className="text-gray-600">Od {formattedStartDate} do {formattedEndDate}</p>
            </div>
            <p>Sprawdzamy Twoją prośbę i wkrótce się odezwiemy.</p>
          </>
        ),
        pt: (
          <>
            <p>Recebemos seu pedido de reserva.</p>
            <div className="bg-gray-100 rounded-lg p-4 my-3">
              <p className="font-medium text-gray-900">Reserva #{reservationNumber}</p>
              <p className="text-gray-600">De {formattedStartDate} a {formattedEndDate}</p>
            </div>
            <p>Estamos analisando seu pedido e entraremos em contato em breve.</p>
          </>
        ),
      },
      // Add other event types with simplified content
    }

    // Default body for event types not explicitly defined
    const defaultBody: Record<EmailLocale, React.ReactNode> = {
      fr: (
        <>
          <div className="bg-gray-100 rounded-lg p-4 my-3">
            <p className="font-medium text-gray-900">Réservation #{reservationNumber}</p>
            <p className="text-gray-600">Du {formattedStartDate} au {formattedEndDate}</p>
          </div>
        </>
      ),
      en: (
        <>
          <div className="bg-gray-100 rounded-lg p-4 my-3">
            <p className="font-medium text-gray-900">Reservation #{reservationNumber}</p>
            <p className="text-gray-600">From {formattedStartDate} to {formattedEndDate}</p>
          </div>
        </>
      ),
      de: (
        <>
          <div className="bg-gray-100 rounded-lg p-4 my-3">
            <p className="font-medium text-gray-900">Reservierung #{reservationNumber}</p>
            <p className="text-gray-600">Vom {formattedStartDate} bis {formattedEndDate}</p>
          </div>
        </>
      ),
      es: (
        <>
          <div className="bg-gray-100 rounded-lg p-4 my-3">
            <p className="font-medium text-gray-900">Reserva #{reservationNumber}</p>
            <p className="text-gray-600">Del {formattedStartDate} al {formattedEndDate}</p>
          </div>
        </>
      ),
      it: (
        <>
          <div className="bg-gray-100 rounded-lg p-4 my-3">
            <p className="font-medium text-gray-900">Prenotazione #{reservationNumber}</p>
            <p className="text-gray-600">Dal {formattedStartDate} al {formattedEndDate}</p>
          </div>
        </>
      ),
      nl: (
        <>
          <div className="bg-gray-100 rounded-lg p-4 my-3">
            <p className="font-medium text-gray-900">Reservering #{reservationNumber}</p>
            <p className="text-gray-600">Van {formattedStartDate} tot {formattedEndDate}</p>
          </div>
        </>
      ),
      pl: (
        <>
          <div className="bg-gray-100 rounded-lg p-4 my-3">
            <p className="font-medium text-gray-900">Rezerwacja #{reservationNumber}</p>
            <p className="text-gray-600">Od {formattedStartDate} do {formattedEndDate}</p>
          </div>
        </>
      ),
      pt: (
        <>
          <div className="bg-gray-100 rounded-lg p-4 my-3">
            <p className="font-medium text-gray-900">Reserva #{reservationNumber}</p>
            <p className="text-gray-600">De {formattedStartDate} a {formattedEndDate}</p>
          </div>
        </>
      ),
    }

    const ctaButtons: Record<string, Record<EmailLocale, string>> = {
      customer_request_received: {
        fr: 'Voir ma demande',
        en: 'View my request',
        de: 'Meine Anfrage ansehen',
        es: 'Ver mi solicitud',
        it: 'Visualizza la mia richiesta',
        nl: 'Bekijk mijn aanvraag',
        pl: 'Zobacz moją prośbę',
        pt: 'Ver meu pedido',
      },
      thank_you_review: {
        fr: 'Laisser un avis',
        en: 'Leave a review',
        de: 'Bewertung abgeben',
        es: 'Dejar una reseña',
        it: 'Lascia una recensione',
        nl: 'Laat een review achter',
        pl: 'Zostaw opinię',
        pt: 'Deixar uma avaliação',
      },
    }

    return {
      title: titles[eventType]?.[locale] || titles['customer_request_received'][locale],
      greeting: greetings[locale],
      body: bodies[eventType]?.[locale] || defaultBody[locale],
      cta: ctaButtons[eventType]?.[locale],
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
      ctaButton={content.cta ? { text: content.cta } : undefined}
    />
  )
}
