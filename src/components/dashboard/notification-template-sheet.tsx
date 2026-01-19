'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { format, addDays, type Locale } from 'date-fns'
import { fr, enUS, de, es, it, nl, pl, pt } from 'date-fns/locale'
import { Mail, Smartphone } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { SmsPreviewCompact, replaceSmsVariables } from './sms-preview'
import { EmailPreviewCompact } from './email-preview'
import type { CustomerNotificationEventType, CustomerNotificationTemplate } from '@/types/store'
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

  // Reset state when sheet opens
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
      startDate,
      endDate,
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

  const eventLabel =
    EVENT_LABELS[eventType]?.[locale] || EVENT_LABELS[eventType]?.['en'] || eventType

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle>{eventLabel}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Tab Switcher */}
          <div className="px-6 pt-6">
            <div className="inline-flex rounded-lg bg-muted p-1">
              <button
                onClick={() => setActiveTab('email')}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  activeTab === 'email'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Mail className="h-4 w-4" />
                Email
              </button>
              <button
                onClick={() => setActiveTab('sms')}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  activeTab === 'sms'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Smartphone className="h-4 w-4" />
                SMS
              </button>
            </div>
          </div>

          {/* Email Tab */}
          {activeTab === 'email' && (
            <div className="p-6 space-y-6">
              {/* Subject */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="subject">{t('subject')}</Label>
                  {isSubjectCustomized && (
                    <button
                      onClick={() => setSubject(defaultSubject)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
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
                  <Label htmlFor="emailMessage">{t('additionalMessage')}</Label>
                  {emailMessage && (
                    <button
                      onClick={() => setEmailMessage('')}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
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
                  rows={3}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">{t('additionalMessageHint')}</p>
              </div>

              {/* Preview */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">
                    {t('preview')}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <EmailPreviewCompact
                  storeName={store.name}
                  logoUrl={store.logoUrl}
                  primaryColor={store.theme?.primaryColor}
                  subject={subject}
                  additionalMessage={emailMessage || undefined}
                  locale={locale}
                  eventType={eventType}
                  customerName={previewData.customerName}
                  reservationNumber={previewData.reservationNumber}
                  startDate={previewData.startDate}
                  endDate={previewData.endDate}
                />
              </div>
            </div>
          )}

          {/* SMS Tab */}
          {activeTab === 'sms' && (
            <div className="p-6 space-y-6">
              {/* SMS message */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="smsMessage">{t('smsMessage')}</Label>
                  {isSmsCustomized && (
                    <button
                      onClick={() => setSmsMessage(defaultSms)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t('resetToDefault')}
                    </button>
                  )}
                </div>
                <Textarea
                  id="smsMessage"
                  value={smsMessage}
                  onChange={(e) => setSmsMessage(e.target.value)}
                  rows={5}
                  className="font-mono text-sm resize-none"
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('smsVariables')}</span>
                  <span className={smsMessage.length > 160 ? 'text-amber-600 font-medium' : ''}>
                    {smsMessage.length}/160
                  </span>
                </div>
              </div>

              {/* Preview */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">
                    {t('preview')}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <SmsPreviewCompact message={previewSms} storeName={store.name} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button onClick={handleSave}>{tc('save')}</Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
