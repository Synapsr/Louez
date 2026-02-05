'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { format, addDays, type Locale } from 'date-fns'
import { fr, enUS, de, es, it, nl, pl, pt } from 'date-fns/locale'
import { Mail, Smartphone } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import { Textarea } from '@louez/ui'
import { Label } from '@louez/ui'
import { cn } from '@louez/utils'
import { replaceSmsVariables } from './sms-preview'
import type { CustomerNotificationEventType, CustomerNotificationTemplate } from '@louez/types'
import type { EmailLocale } from '@/lib/email/i18n'

import {
  DEFAULT_SUBJECTS,
  DEFAULT_SMS_TEMPLATES,
} from '@/app/(dashboard)/dashboard/settings/notifications/customer-template-modal'

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

interface NotificationTemplateSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventType: CustomerNotificationEventType | 'thank_you_review'
  template?: CustomerNotificationTemplate
  onSave: (template: CustomerNotificationTemplate) => void
  locale: EmailLocale
  store: {
    name: string
    logoUrl?: string | null
    email?: string | null
    phone?: string | null
    address?: string | null
    theme?: {
      primaryColor?: string
    } | null
  }
}

// Event type labels
const EVENT_LABELS: Record<string, Record<EmailLocale, string>> = {
  customer_request_received: {
    fr: 'Demande reçue',
    en: 'Request received',
    de: 'Anfrage erhalten',
    es: 'Solicitud recibida',
    it: 'Richiesta ricevuta',
    nl: 'Aanvraag ontvangen',
    pl: 'Prośba otrzymana',
    pt: 'Pedido recebido',
  },
  customer_request_accepted: {
    fr: 'Demande acceptée',
    en: 'Request accepted',
    de: 'Anfrage akzeptiert',
    es: 'Solicitud aceptada',
    it: 'Richiesta accettata',
    nl: 'Aanvraag geaccepteerd',
    pl: 'Prośba zaakceptowana',
    pt: 'Pedido aceito',
  },
  customer_request_rejected: {
    fr: 'Demande refusée',
    en: 'Request declined',
    de: 'Anfrage abgelehnt',
    es: 'Solicitud rechazada',
    it: 'Richiesta rifiutata',
    nl: 'Aanvraag afgewezen',
    pl: 'Prośba odrzucona',
    pt: 'Pedido recusado',
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
    fr: 'Rappel de retrait',
    en: 'Pickup reminder',
    de: 'Abholungserinnerung',
    es: 'Recordatorio de recogida',
    it: 'Promemoria ritiro',
    nl: 'Ophaalherinnering',
    pl: 'Przypomnienie o odbiorze',
    pt: 'Lembrete de retirada',
  },
  customer_reminder_return: {
    fr: 'Rappel de retour',
    en: 'Return reminder',
    de: 'Rückgabeerinnerung',
    es: 'Recordatorio de devolución',
    it: 'Promemoria restituzione',
    nl: 'Retourherinnering',
    pl: 'Przypomnienie o zwrocie',
    pt: 'Lembrete de devolução',
  },
  thank_you_review: {
    fr: "Demande d'avis",
    en: 'Review request',
    de: 'Bewertungsanfrage',
    es: 'Solicitud de opinión',
    it: 'Richiesta recensione',
    nl: 'Beoordelingsverzoek',
    pl: 'Prośba o opinię',
    pt: 'Pedido de avaliação',
  },
}

// Email titles per event type
const EMAIL_TITLES: Record<string, Record<EmailLocale, string>> = {
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

// Email body descriptions per event type
const EMAIL_BODY_DESCRIPTIONS: Record<string, Record<EmailLocale, string>> = {
  customer_request_received: {
    fr: 'Nous avons bien reçu votre demande de réservation. Notre équipe va l\'examiner et vous répondre dans les plus brefs délais.',
    en: 'We have received your reservation request. Our team will review it and get back to you as soon as possible.',
    de: 'Wir haben Ihre Reservierungsanfrage erhalten. Unser Team wird sie prüfen und sich so schnell wie möglich bei Ihnen melden.',
    es: 'Hemos recibido su solicitud de reserva. Nuestro equipo la revisará y le responderá lo antes posible.',
    it: 'Abbiamo ricevuto la tua richiesta di prenotazione. Il nostro team la esaminerà e ti risponderà al più presto.',
    nl: 'We hebben uw reserveringsaanvraag ontvangen. Ons team zal deze bekijken en zo snel mogelijk contact met u opnemen.',
    pl: 'Otrzymaliśmy Twoją prośbę o rezerwację. Nasz zespół ją sprawdzi i skontaktuje się z Tobą jak najszybciej.',
    pt: 'Recebemos seu pedido de reserva. Nossa equipe irá analisá-lo e retornará o mais breve possível.',
  },
  customer_request_accepted: {
    fr: 'Bonne nouvelle ! Votre demande de réservation a été acceptée. Vous pouvez maintenant finaliser votre réservation.',
    en: 'Good news! Your reservation request has been accepted. You can now finalize your reservation.',
    de: 'Gute Neuigkeiten! Ihre Reservierungsanfrage wurde akzeptiert. Sie können Ihre Reservierung jetzt abschließen.',
    es: '¡Buenas noticias! Su solicitud de reserva ha sido aceptada. Ahora puede finalizar su reserva.',
    it: 'Buone notizie! La tua richiesta di prenotazione è stata accettata. Ora puoi finalizzare la tua prenotazione.',
    nl: 'Goed nieuws! Uw reserveringsaanvraag is geaccepteerd. U kunt nu uw reservering voltooien.',
    pl: 'Dobre wieści! Twoja prośba o rezerwację została zaakceptowana. Możesz teraz sfinalizować rezerwację.',
    pt: 'Boas notícias! Seu pedido de reserva foi aceito. Agora você pode finalizar sua reserva.',
  },
  customer_request_rejected: {
    fr: 'Malheureusement, nous ne sommes pas en mesure d\'accepter votre demande pour les dates demandées. N\'hésitez pas à nous contacter pour trouver une alternative.',
    en: 'Unfortunately, we are unable to accept your request for the requested dates. Please feel free to contact us to find an alternative.',
    de: 'Leider können wir Ihre Anfrage für die gewünschten Daten nicht annehmen. Bitte kontaktieren Sie uns, um eine Alternative zu finden.',
    es: 'Lamentablemente, no podemos aceptar su solicitud para las fechas solicitadas. No dude en contactarnos para encontrar una alternativa.',
    it: 'Purtroppo non siamo in grado di accettare la tua richiesta per le date richieste. Non esitare a contattarci per trovare un\'alternativa.',
    nl: 'Helaas kunnen we uw aanvraag voor de gevraagde datums niet accepteren. Neem gerust contact met ons op om een alternatief te vinden.',
    pl: 'Niestety nie możemy przyjąć Twojej prośby na żądane daty. Skontaktuj się z nami, aby znaleźć alternatywę.',
    pt: 'Infelizmente, não podemos aceitar seu pedido para as datas solicitadas. Sinta-se à vontade para nos contatar para encontrar uma alternativa.',
  },
  customer_reservation_confirmed: {
    fr: 'Votre réservation est maintenant confirmée. Retrouvez ci-dessous tous les détails de votre location.',
    en: 'Your reservation is now confirmed. Below you will find all the details of your rental.',
    de: 'Ihre Reservierung ist nun bestätigt. Nachfolgend finden Sie alle Details Ihrer Anmietung.',
    es: 'Su reserva está confirmada. A continuación encontrará todos los detalles de su alquiler.',
    it: 'La tua prenotazione è ora confermata. Di seguito trovi tutti i dettagli del tuo noleggio.',
    nl: 'Uw reservering is nu bevestigd. Hieronder vindt u alle details van uw huur.',
    pl: 'Twoja rezerwacja jest potwierdzona. Poniżej znajdziesz wszystkie szczegóły wynajmu.',
    pt: 'Sua reserva está confirmada. Abaixo você encontrará todos os detalhes do seu aluguel.',
  },
  customer_reminder_pickup: {
    fr: 'N\'oubliez pas ! Votre retrait est prévu pour demain. Pensez à vous munir de votre pièce d\'identité.',
    en: 'Don\'t forget! Your pickup is scheduled for tomorrow. Remember to bring your ID.',
    de: 'Nicht vergessen! Ihre Abholung ist für morgen geplant. Bringen Sie bitte Ihren Ausweis mit.',
    es: '¡No lo olvide! Su recogida está programada para mañana. Recuerde traer su identificación.',
    it: 'Non dimenticare! Il tuo ritiro è previsto per domani. Ricordati di portare un documento d\'identità.',
    nl: 'Niet vergeten! Uw ophaalmoment is gepland voor morgen. Vergeet uw identiteitsbewijs niet mee te nemen.',
    pl: 'Nie zapomnij! Twój odbiór jest zaplanowany na jutro. Pamiętaj o zabraniu dokumentu tożsamości.',
    pt: 'Não se esqueça! Sua retirada está agendada para amanhã. Lembre-se de trazer seu documento de identidade.',
  },
  customer_reminder_return: {
    fr: 'N\'oubliez pas ! Le retour de votre location est prévu pour demain. Merci de vous assurer que tout le matériel est en bon état.',
    en: 'Don\'t forget! Your rental return is scheduled for tomorrow. Please make sure all equipment is in good condition.',
    de: 'Nicht vergessen! Ihre Rückgabe ist für morgen geplant. Bitte stellen Sie sicher, dass alle Geräte in gutem Zustand sind.',
    es: '¡No lo olvide! La devolución de su alquiler está programada para mañana. Asegúrese de que todo el equipo esté en buen estado.',
    it: 'Non dimenticare! La restituzione del tuo noleggio è prevista per domani. Assicurati che tutta l\'attrezzatura sia in buone condizioni.',
    nl: 'Niet vergeten! De retour van uw huur is gepland voor morgen. Zorg ervoor dat alle apparatuur in goede staat is.',
    pl: 'Nie zapomnij! Zwrot wynajmu jest zaplanowany na jutro. Upewnij się, że cały sprzęt jest w dobrym stanie.',
    pt: 'Não se esqueça! A devolução do seu aluguel está agendada para amanhã. Certifique-se de que todo o equipamento esteja em boas condições.',
  },
  thank_you_review: {
    fr: 'Nous espérons que votre location s\'est bien passée ! Votre avis est précieux et nous aide à améliorer nos services.',
    en: 'We hope your rental went well! Your review is valuable and helps us improve our services.',
    de: 'Wir hoffen, dass Ihre Miete gut verlaufen ist! Ihre Bewertung ist wertvoll und hilft uns, unsere Dienstleistungen zu verbessern.',
    es: '¡Esperamos que su alquiler haya ido bien! Su opinión es valiosa y nos ayuda a mejorar nuestros servicios.',
    it: 'Speriamo che il tuo noleggio sia andato bene! La tua recensione è preziosa e ci aiuta a migliorare i nostri servizi.',
    nl: 'We hopen dat uw verhuur goed is verlopen! Uw beoordeling is waardevol en helpt ons onze diensten te verbeteren.',
    pl: 'Mamy nadzieję, że wynajem przebiegł pomyślnie! Twoja opinia jest cenna i pomaga nam ulepszać nasze usługi.',
    pt: 'Esperamos que seu aluguel tenha corrido bem! Sua avaliação é valiosa e nos ajuda a melhorar nossos serviços.',
  },
}

const THANK_YOU_SUBJECTS: Record<EmailLocale, string> = {
  fr: 'Merci pour votre location ! Votre avis compte',
  en: 'Thank you for your rental! Your opinion matters',
  de: 'Vielen Dank für Ihre Miete! Ihre Meinung zählt',
  es: '¡Gracias por su alquiler! Su opinión importa',
  it: 'Grazie per il tuo noleggio! La tua opinione conta',
  nl: 'Bedankt voor uw verhuur! Uw mening telt',
  pl: 'Dziękujemy za wynajem! Twoja opinia ma znaczenie',
  pt: 'Obrigado pelo seu aluguel! Sua opinião é importante',
}

const THANK_YOU_SMS: Record<EmailLocale, string> = {
  fr: '{storeName}\nMerci pour votre location !\nVotre avis nous aiderait beaucoup.\n{reviewUrl}',
  en: '{storeName}\nThank you for your rental!\nYour review would help us a lot.\n{reviewUrl}',
  de: '{storeName}\nVielen Dank für Ihre Miete!\nIhre Bewertung würde uns sehr helfen.\n{reviewUrl}',
  es: '{storeName}\n¡Gracias por su alquiler!\nSu opinión nos ayudaría mucho.\n{reviewUrl}',
  it: '{storeName}\nGrazie per il tuo noleggio!\nLa tua recensione ci aiuterebbe molto.\n{reviewUrl}',
  nl: '{storeName}\nBedankt voor uw verhuur!\nUw beoordeling zou ons enorm helpen.\n{reviewUrl}',
  pl: '{storeName}\nDziękujemy za wynajem!\nTwoja opinia bardzo by nam pomogła.\n{reviewUrl}',
  pt: '{storeName}\nObrigado pelo seu aluguel!\nSua avaliação nos ajudaria muito.\n{reviewUrl}',
}

export function NotificationTemplateSheet({
  open,
  onOpenChange,
  eventType,
  template,
  onSave,
  locale,
  store,
}: NotificationTemplateSheetProps) {
  const t = useTranslations('dashboard.settings.notifications.templateSheet')
  const tc = useTranslations('common')

  const [activeTab, setActiveTab] = useState<'email' | 'sms'>('email')

  // Get defaults
  const defaultSubject = useMemo(() => {
    if (eventType === 'thank_you_review') {
      return THANK_YOU_SUBJECTS[locale] || THANK_YOU_SUBJECTS['en']
    }
    return (
      DEFAULT_SUBJECTS[locale]?.[eventType as CustomerNotificationEventType] ||
      DEFAULT_SUBJECTS['en'][eventType as CustomerNotificationEventType]
    )
  }, [locale, eventType])

  const defaultSms = useMemo(() => {
    if (eventType === 'thank_you_review') {
      return THANK_YOU_SMS[locale] || THANK_YOU_SMS['en']
    }
    return (
      DEFAULT_SMS_TEMPLATES[locale]?.[eventType as CustomerNotificationEventType] ||
      DEFAULT_SMS_TEMPLATES['en'][eventType as CustomerNotificationEventType]
    )
  }, [locale, eventType])

  // Form state
  const [subject, setSubject] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [smsMessage, setSmsMessage] = useState('')

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSubject(template?.subject || defaultSubject)
      setEmailMessage(template?.emailMessage || '')
      setSmsMessage(template?.smsMessage || defaultSms)
      setActiveTab('email')
    }
  }, [open, eventType, template, defaultSubject, defaultSms])

  // Check if customized
  const isSubjectCustomized = subject !== defaultSubject
  const isSmsCustomized = smsMessage !== defaultSms

  // Handle save
  const handleSave = () => {
    onSave({
      subject: isSubjectCustomized ? subject : undefined,
      emailMessage: emailMessage.trim() || undefined,
      smsMessage: isSmsCustomized ? smsMessage : undefined,
    })
    onOpenChange(false)
  }

  // Preview data
  const dateLocale = DATE_LOCALES[locale] || fr
  const previewData = useMemo(() => {
    const now = new Date()
    const startDate = addDays(now, 3)
    const endDate = addDays(now, 5)
    return {
      customerName: 'Jean',
      reservationNumber: '1234',
      formattedStartDate: format(startDate, 'PPP', { locale: dateLocale }),
      formattedEndDate: format(endDate, 'PPP', { locale: dateLocale }),
    }
  }, [dateLocale])

  // SMS preview
  const previewSms = useMemo(() => {
    return replaceSmsVariables(smsMessage, {
      storeName: store.name,
      number: previewData.reservationNumber,
      startDate: previewData.formattedStartDate,
      endDate: previewData.formattedEndDate,
    })
  }, [smsMessage, store.name, previewData])

  // Email content
  const emailTitle = EMAIL_TITLES[eventType]?.[locale] || EMAIL_TITLES[eventType]?.['en'] || ''
  const emailBody = EMAIL_BODY_DESCRIPTIONS[eventType]?.[locale] || EMAIL_BODY_DESCRIPTIONS[eventType]?.['en'] || ''
  const primaryColor = store.theme?.primaryColor || '#0066FF'

  const eventLabel =
    EVENT_LABELS[eventType]?.[locale] || EVENT_LABELS[eventType]?.['en'] || eventType

  const greetings: Record<EmailLocale, string> = {
    fr: `Bonjour ${previewData.customerName},`,
    en: `Hello ${previewData.customerName},`,
    de: `Hallo ${previewData.customerName},`,
    es: `Hola ${previewData.customerName},`,
    it: `Ciao ${previewData.customerName},`,
    nl: `Hallo ${previewData.customerName},`,
    pl: `Cześć ${previewData.customerName},`,
    pt: `Olá ${previewData.customerName},`,
  }

  const reservationLabels: Record<EmailLocale, string> = {
    fr: 'Réservation',
    en: 'Reservation',
    de: 'Reservierung',
    es: 'Reserva',
    it: 'Prenotazione',
    nl: 'Reservering',
    pl: 'Rezerwacja',
    pt: 'Reserva',
  }

  const dateRangeLabels: Record<EmailLocale, { from: string; to: string }> = {
    fr: { from: 'Du', to: 'au' },
    en: { from: 'From', to: 'to' },
    de: { from: 'Vom', to: 'bis' },
    es: { from: 'Del', to: 'al' },
    it: { from: 'Dal', to: 'al' },
    nl: { from: 'Van', to: 'tot' },
    pl: { from: 'Od', to: 'do' },
    pt: { from: 'De', to: 'a' },
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl p-0 gap-0 max-h-[90vh] overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="text-base">{eventLabel}</DialogTitle>
        </DialogHeader>

        {/* Tab Switcher */}
        <div className="px-6 pt-4 shrink-0">
          <div className="inline-flex rounded-lg bg-muted p-1">
            <button
              onClick={() => setActiveTab('email')}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                activeTab === 'email'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Mail className="h-3.5 w-3.5" />
              Email
            </button>
            <button
              onClick={() => setActiveTab('sms')}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                activeTab === 'sms'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Smartphone className="h-3.5 w-3.5" />
              SMS
            </button>
          </div>
        </div>

        {/* Content - Two columns */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid md:grid-cols-2 gap-6 p-6">
            {/* Left Column - Form */}
            <div className="space-y-4">
              {activeTab === 'email' && (
                <>
                  {/* Subject */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="subject" className="text-sm font-medium">
                        {t('subject')}
                      </Label>
                      {isSubjectCustomized && (
                        <button
                          onClick={() => setSubject(defaultSubject)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          {t('resetToDefault')}
                        </button>
                      )}
                    </div>
                    <Input
                      id="subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>

                  {/* Additional message */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="emailMessage" className="text-sm font-medium">
                        {t('additionalMessage')}
                      </Label>
                      {emailMessage && (
                        <button
                          onClick={() => setEmailMessage('')}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          {t('clearMessage')}
                        </button>
                      )}
                    </div>
                    <Textarea
                      id="emailMessage"
                      value={emailMessage}
                      onChange={(e) => setEmailMessage(e.target.value)}
                      placeholder={t('additionalMessagePlaceholder')}
                      rows={4}
                      className="resize-none"
                    />
                    <p className="text-xs text-muted-foreground">{t('additionalMessageHint')}</p>
                  </div>
                </>
              )}

              {activeTab === 'sms' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="smsMessage" className="text-sm font-medium">
                      {t('smsMessage')}
                    </Label>
                    {isSmsCustomized && (
                      <button
                        onClick={() => setSmsMessage(defaultSms)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        {t('resetToDefault')}
                      </button>
                    )}
                  </div>
                  <Textarea
                    id="smsMessage"
                    value={smsMessage}
                    onChange={(e) => setSmsMessage(e.target.value)}
                    rows={6}
                    className="font-mono text-sm resize-none"
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t('smsVariables')}</span>
                    <span className={smsMessage.length > 160 ? 'text-amber-500 font-medium' : ''}>
                      {smsMessage.length}/160
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column - Preview */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">{t('preview')}</p>

              {activeTab === 'email' && (
                <div className="rounded-lg border bg-muted/30 overflow-hidden">
                  {/* Email client header */}
                  <div className="bg-muted/50 px-4 py-3 border-b">
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                      <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex gap-2">
                        <span className="text-muted-foreground w-10">De:</span>
                        <span className="font-medium truncate">
                          {store.name} &lt;{store.email || 'noreply@louez.io'}&gt;
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-muted-foreground w-10">Objet:</span>
                        <span className="font-medium truncate">{subject}</span>
                      </div>
                    </div>
                  </div>

                  {/* Email body */}
                  <div className="bg-[#f6f9fc] dark:bg-muted/20 p-4">
                    <div className="bg-white dark:bg-card rounded-lg shadow-sm overflow-hidden max-w-sm mx-auto">
                      {/* Header */}
                      <div
                        className="px-4 py-3 text-center bg-muted/30"
                        style={{ borderBottom: `3px solid ${primaryColor}` }}
                      >
                        {store.logoUrl ? (
                          <img
                            src={store.logoUrl}
                            alt={store.name}
                            className="h-8 mx-auto object-contain"
                          />
                        ) : (
                          <span className="text-base font-bold" style={{ color: primaryColor }}>
                            {store.name}
                          </span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="p-4 space-y-3">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-foreground">
                          {emailTitle}
                        </h3>
                        <p className="text-xs text-gray-600 dark:text-muted-foreground">
                          {greetings[locale]}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-muted-foreground leading-relaxed">
                          {emailBody}
                        </p>

                        {/* Reservation info box */}
                        <div className="bg-gray-100 dark:bg-muted rounded-md p-3">
                          <p className="text-xs font-medium text-gray-900 dark:text-foreground">
                            {reservationLabels[locale]} #{previewData.reservationNumber}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-muted-foreground">
                            {dateRangeLabels[locale].from} {previewData.formattedStartDate}{' '}
                            {dateRangeLabels[locale].to} {previewData.formattedEndDate}
                          </p>
                        </div>

                        {/* Additional message */}
                        {emailMessage && (
                          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 rounded-md p-3">
                            <p className="text-xs text-gray-700 dark:text-blue-100 whitespace-pre-wrap">
                              {emailMessage}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Footer */}
                      <div className="bg-gray-50 dark:bg-muted/50 px-4 py-3 border-t text-center">
                        <p className="text-[10px] text-gray-500 dark:text-muted-foreground">
                          {store.name} • Propulsé par Louez.io
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'sms' && (
                <div className="rounded-lg border overflow-hidden">
                  <div className="bg-muted/50 px-4 py-3 border-b flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-primary">
                        {store.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{store.name}</p>
                      <p className="text-xs text-muted-foreground">SMS</p>
                    </div>
                  </div>
                  <div className="p-4 bg-muted/20 min-h-[200px]">
                    <div className="bg-card border rounded-2xl rounded-tl-md px-4 py-3 max-w-[85%] shadow-sm">
                      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                        {previewSms}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-2 text-right">
                        Maintenant
                      </p>
                    </div>
                  </div>
                  <div className="px-4 py-2 border-t bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{Math.ceil(smsMessage.length / 160) || 1} SMS</span>
                    <span className={smsMessage.length > 160 ? 'text-amber-500 font-medium' : ''}>
                      {smsMessage.length} caractères
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex justify-end gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button size="sm" onClick={handleSave}>
            {tc('save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
