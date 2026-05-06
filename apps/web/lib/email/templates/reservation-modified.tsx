import { Button, Heading, Hr, Section, Text } from '@react-email/components'
import { BaseLayout } from './base-layout'
import { getContrastColorHex } from '@/lib/utils/colors'
import {
  getDateFormatPatterns,
  getEmailTranslations,
  type EmailLocale,
} from '../i18n'
import {
  formatEmailDateInStoreTimezone,
  getStoreTimezoneLabel,
} from '../date-time'

interface ReservationModifiedEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeAddress?: string | null
  storePhone?: string | null
  storeEmail?: string | null
  storeTimezone?: string | null
  storeCountry?: string | null
  customerFirstName: string
  reservationNumber: string
  previousStartDate?: Date | null
  previousEndDate?: Date | null
  startDate: Date
  endDate: Date
  reservationUrl: string
  locale?: EmailLocale
}

const messagesByLocale: Record<
  EmailLocale,
  {
    subject: string
    title: string
    body: string
    scheduleChanged: string
    previousSchedule: string
    newSchedule: string
    fromTo: string
  }
> = {
  fr: {
    subject: 'Votre réservation #{number} a été modifiée',
    title: 'Réservation modifiée',
    body: 'Votre réservation #{number} a été mise à jour. Vous pouvez consulter les détails à jour depuis votre espace client.',
    scheduleChanged: "L'horaire de votre réservation a changé.",
    previousSchedule: 'Ancien horaire',
    newSchedule: 'Nouvel horaire',
    fromTo: 'Du {startDate} au {endDate}',
  },
  en: {
    subject: 'Your reservation #{number} was updated',
    title: 'Reservation updated',
    body: 'Your reservation #{number} has been updated. You can view the latest details from your customer account.',
    scheduleChanged: 'Your reservation schedule has changed.',
    previousSchedule: 'Previous schedule',
    newSchedule: 'New schedule',
    fromTo: 'From {startDate} to {endDate}',
  },
  de: {
    subject: 'Ihre Reservierung #{number} wurde aktualisiert',
    title: 'Reservierung aktualisiert',
    body: 'Ihre Reservierung #{number} wurde aktualisiert. Sie können die aktuellen Details in Ihrem Kundenkonto einsehen.',
    scheduleChanged: 'Der Zeitplan Ihrer Reservierung hat sich geändert.',
    previousSchedule: 'Bisheriger Zeitplan',
    newSchedule: 'Neuer Zeitplan',
    fromTo: 'Von {startDate} bis {endDate}',
  },
  es: {
    subject: 'Su reserva #{number} ha sido modificada',
    title: 'Reserva modificada',
    body: 'Su reserva #{number} se ha actualizado. Puede ver los detalles actualizados desde su cuenta de cliente.',
    scheduleChanged: 'El horario de su reserva ha cambiado.',
    previousSchedule: 'Horario anterior',
    newSchedule: 'Nuevo horario',
    fromTo: 'Del {startDate} al {endDate}',
  },
  it: {
    subject: 'La tua prenotazione #{number} è stata modificata',
    title: 'Prenotazione modificata',
    body: 'La tua prenotazione #{number} è stata aggiornata. Puoi vedere i dettagli aggiornati dal tuo account cliente.',
    scheduleChanged: 'L’orario della tua prenotazione è cambiato.',
    previousSchedule: 'Orario precedente',
    newSchedule: 'Nuovo orario',
    fromTo: 'Dal {startDate} al {endDate}',
  },
  nl: {
    subject: 'Uw reservering #{number} is gewijzigd',
    title: 'Reservering gewijzigd',
    body: 'Uw reservering #{number} is bijgewerkt. U kunt de actuele details bekijken in uw klantaccount.',
    scheduleChanged: 'De planning van uw reservering is gewijzigd.',
    previousSchedule: 'Vorige planning',
    newSchedule: 'Nieuwe planning',
    fromTo: 'Van {startDate} tot {endDate}',
  },
  pl: {
    subject: 'Twoja rezerwacja #{number} została zmieniona',
    title: 'Rezerwacja zmieniona',
    body: 'Twoja rezerwacja #{number} została zaktualizowana. Aktualne szczegóły znajdziesz na swoim koncie klienta.',
    scheduleChanged: 'Termin Twojej rezerwacji uległ zmianie.',
    previousSchedule: 'Poprzedni termin',
    newSchedule: 'Nowy termin',
    fromTo: 'Od {startDate} do {endDate}',
  },
  pt: {
    subject: 'A sua reserva #{number} foi alterada',
    title: 'Reserva alterada',
    body: 'A sua reserva #{number} foi atualizada. Pode consultar os detalhes atualizados na sua conta de cliente.',
    scheduleChanged: 'O horario da sua reserva foi alterado.',
    previousSchedule: 'Horario anterior',
    newSchedule: 'Novo horario',
    fromTo: 'De {startDate} ate {endDate}',
  },
}

export function getReservationModifiedEmailSubject(
  reservationNumber: string,
  locale: EmailLocale = 'fr',
) {
  return messagesByLocale[locale].subject.replace('{number}', reservationNumber)
}

export function ReservationModifiedEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeAddress,
  storePhone,
  storeEmail,
  storeTimezone,
  storeCountry,
  customerFirstName,
  reservationNumber,
  previousStartDate,
  previousEndDate,
  startDate,
  endDate,
  reservationUrl,
  locale = 'fr',
}: ReservationModifiedEmailProps) {
  const t = getEmailTranslations(locale)
  const tc = t.common
  const messages = messagesByLocale[locale]
  const datePatterns = getDateFormatPatterns(locale)
  const timezoneLabel = getStoreTimezoneLabel(startDate, storeTimezone, storeCountry)
  const timezoneLine =
    typeof tc.timezone === 'string'
      ? tc.timezone.replace('{timezone}', timezoneLabel)
      : `Timezone: ${timezoneLabel}`
  const hasScheduleChange =
    previousStartDate instanceof Date &&
    previousEndDate instanceof Date &&
    (previousStartDate.getTime() !== startDate.getTime() ||
      previousEndDate.getTime() !== endDate.getTime())

  const formatPeriod = (periodStart: Date, periodEnd: Date) =>
    messages.fromTo
      .replace(
        '{startDate}',
        formatEmailDateInStoreTimezone(
          periodStart,
          locale,
          datePatterns.full,
          storeTimezone,
          storeCountry,
        ),
      )
      .replace(
        '{endDate}',
        formatEmailDateInStoreTimezone(
          periodEnd,
          locale,
          datePatterns.full,
          storeTimezone,
          storeCountry,
        ),
      )

  const buttonStyle = {
    ...button,
    backgroundColor: primaryColor,
    color: getContrastColorHex(primaryColor),
  }

  return (
    <BaseLayout
      preview={messages.subject.replace('{number}', reservationNumber)}
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      storeAddress={storeAddress}
      locale={locale}
    >
      <Heading style={heading}>{messages.title}</Heading>
      <Text style={paragraph}>{tc.greeting.replace('{name}', customerFirstName)}</Text>
      <Text style={paragraph}>{messages.body.replace('{number}', reservationNumber)}</Text>

      {hasScheduleChange && previousStartDate && previousEndDate && (
        <Section style={section}>
          <Text style={sectionTitle}>{messages.scheduleChanged}</Text>
          <Text style={label}>{messages.previousSchedule}</Text>
          <Text style={paragraph}>{formatPeriod(previousStartDate, previousEndDate)}</Text>
          <Text style={label}>{messages.newSchedule}</Text>
          <Text style={paragraph}>{formatPeriod(startDate, endDate)}</Text>
          <Text style={timezoneText}>{timezoneLine}</Text>
        </Section>
      )}

      {!hasScheduleChange && (
        <Section style={section}>
          <Text style={sectionTitle}>{tc.period}</Text>
          <Text style={paragraph}>{formatPeriod(startDate, endDate)}</Text>
          <Text style={timezoneText}>{timezoneLine}</Text>
        </Section>
      )}

      <Hr style={hr} />

      <Section style={ctaSection}>
        <Button href={reservationUrl} style={buttonStyle}>
          {tc.viewReservation}
        </Button>
      </Section>
    </BaseLayout>
  )
}

const heading = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#1a1a1a',
  marginBottom: '24px',
}

const paragraph = {
  fontSize: '14px',
  lineHeight: '24px',
  color: '#525f7f',
  margin: '0 0 10px 0',
}

const section = {
  marginTop: '24px',
  marginBottom: '24px',
}

const sectionTitle = {
  fontSize: '14px',
  fontWeight: 'bold' as const,
  color: '#1a1a1a',
  margin: '0 0 12px 0',
}

const label = {
  fontSize: '12px',
  fontWeight: 'bold' as const,
  textTransform: 'uppercase' as const,
  color: '#8898aa',
  margin: '16px 0 4px 0',
}

const timezoneText = {
  fontSize: '12px',
  lineHeight: '18px',
  color: '#8898aa',
  margin: '4px 0 0 0',
}

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 0',
}

const ctaSection = {
  textAlign: 'center' as const,
  marginTop: '32px',
  marginBottom: '32px',
}

const button = {
  backgroundColor: '#0066FF',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '14px',
  fontWeight: 'bold' as const,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 24px',
}

export default ReservationModifiedEmail
