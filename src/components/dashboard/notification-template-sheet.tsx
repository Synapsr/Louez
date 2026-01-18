'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { format, addDays, type Locale } from 'date-fns'
import { fr, enUS, de, es, it, nl, pl, pt } from 'date-fns/locale'
import { Mail, Smartphone, RotateCcw, Eye, EyeOff } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { EventEmailPreview } from './email-preview'
import { SmsPreview, replaceSmsVariables } from './sms-preview'
import type { CustomerNotificationEventType, CustomerNotificationTemplate } from '@/types/store'
import type { EmailLocale } from '@/lib/email/i18n'

// Re-export defaults from the modal for consistency
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
  // Store info for preview
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

// Event type labels for the sheet title
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
    fr: 'Demande d\'avis',
    en: 'Review request',
    de: 'Bewertungsanfrage',
    es: 'Solicitud de opinión',
    it: 'Richiesta recensione',
    nl: 'Beoordelingsverzoek',
    pl: 'Prośba o opinię',
    pt: 'Pedido de avaliação',
  },
}

// Default subjects for thank_you_review
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

// Default SMS templates for thank_you_review
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
  const [showPreview, setShowPreview] = useState(true)

  // Get defaults for current locale and event type
  const defaultSubject = useMemo(() => {
    if (eventType === 'thank_you_review') {
      return THANK_YOU_SUBJECTS[locale] || THANK_YOU_SUBJECTS['en']
    }
    return DEFAULT_SUBJECTS[locale]?.[eventType as CustomerNotificationEventType] ||
      DEFAULT_SUBJECTS['en'][eventType as CustomerNotificationEventType]
  }, [locale, eventType])

  const defaultSms = useMemo(() => {
    if (eventType === 'thank_you_review') {
      return THANK_YOU_SMS[locale] || THANK_YOU_SMS['en']
    }
    return DEFAULT_SMS_TEMPLATES[locale]?.[eventType as CustomerNotificationEventType] ||
      DEFAULT_SMS_TEMPLATES['en'][eventType as CustomerNotificationEventType]
  }, [locale, eventType])

  // Form state
  const [subject, setSubject] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [smsMessage, setSmsMessage] = useState('')

  // Reset state when sheet opens or eventType changes
  useEffect(() => {
    if (open) {
      setSubject(template?.subject || defaultSubject)
      setEmailMessage(template?.emailMessage || '')
      setSmsMessage(template?.smsMessage || defaultSms)
      setActiveTab('email')
      setShowPreview(true)
    }
  }, [open, eventType, template, defaultSubject, defaultSms])

  // Check if values are customized
  const isSubjectCustomized = subject !== defaultSubject
  const isSmsCustomized = smsMessage !== defaultSms
  const isEmailMessageCustomized = emailMessage.trim() !== ''

  // Handle save
  const handleSave = () => {
    onSave({
      subject: isSubjectCustomized ? subject : undefined,
      emailMessage: isEmailMessageCustomized ? emailMessage : undefined,
      smsMessage: isSmsCustomized ? smsMessage : undefined,
    })
    onOpenChange(false)
  }

  // Reset handlers
  const handleResetSubject = () => setSubject(defaultSubject)
  const handleResetSms = () => setSmsMessage(defaultSms)
  const handleResetEmailMessage = () => setEmailMessage('')

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

  // SMS with replaced variables for preview
  const previewSms = useMemo(() => {
    return replaceSmsVariables(smsMessage, {
      storeName: store.name,
      number: previewData.reservationNumber,
      startDate: previewData.formattedStartDate,
      endDate: previewData.formattedEndDate,
    })
  }, [smsMessage, store.name, previewData])

  // Event label for title
  const eventLabel = EVENT_LABELS[eventType]?.[locale] || EVENT_LABELS[eventType]?.['en'] || eventType

  return (
    <TooltipProvider>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle className="text-lg">{eventLabel}</SheetTitle>
          </SheetHeader>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'email' | 'sms')}>
            <div className="flex items-center justify-between mb-4">
              <TabsList className="grid w-fit grid-cols-2">
                <TabsTrigger value="email" className="gap-2">
                  <Mail className="h-4 w-4" />
                  Email
                </TabsTrigger>
                <TabsTrigger value="sms" className="gap-2">
                  <Smartphone className="h-4 w-4" />
                  SMS
                </TabsTrigger>
              </TabsList>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
                className="gap-2"
              >
                {showPreview ? (
                  <>
                    <EyeOff className="h-4 w-4" />
                    {t('hidePreview')}
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4" />
                    {t('showPreview')}
                  </>
                )}
              </Button>
            </div>

            {/* Email Tab */}
            <TabsContent value="email" className="space-y-6 mt-0">
              {/* Configuration */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  {t('configuration')}
                </h3>

                {/* Subject field */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">{t('subject')}</Label>
                    <div className="flex items-center gap-2">
                      {isSubjectCustomized ? (
                        <>
                          <Badge variant="secondary" className="text-xs">
                            {t('customized')}
                          </Badge>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={handleResetSubject}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('resetToDefault')}</TooltipContent>
                          </Tooltip>
                        </>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          {t('default')}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>

                {/* Additional message */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">{t('additionalMessage')}</Label>
                    {isEmailMessageCustomized && (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {t('customized')}
                        </Badge>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={handleResetEmailMessage}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('clearMessage')}</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                  <Textarea
                    value={emailMessage}
                    onChange={(e) => setEmailMessage(e.target.value)}
                    placeholder={t('additionalMessagePlaceholder')}
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('additionalMessageHint')}
                  </p>
                </div>
              </div>

              {/* Email Preview */}
              <Collapsible open={showPreview} onOpenChange={setShowPreview}>
                <CollapsibleContent>
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                      {t('preview')}
                    </h3>
                    <EventEmailPreview
                      storeName={store.name}
                      logoUrl={store.logoUrl}
                      primaryColor={store.theme?.primaryColor}
                      storeEmail={store.email}
                      storePhone={store.phone}
                      storeAddress={store.address}
                      locale={locale}
                      customerName={previewData.customerName}
                      reservationNumber={previewData.reservationNumber}
                      startDate={previewData.startDate}
                      endDate={previewData.endDate}
                      subject={subject}
                      additionalMessage={emailMessage || undefined}
                      eventType={eventType}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </TabsContent>

            {/* SMS Tab */}
            <TabsContent value="sms" className="space-y-6 mt-0">
              {/* Configuration */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  {t('configuration')}
                </h3>

                {/* SMS message */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">{t('smsMessage')}</Label>
                    <div className="flex items-center gap-2">
                      {isSmsCustomized ? (
                        <>
                          <Badge variant="secondary" className="text-xs">
                            {t('customized')}
                          </Badge>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={handleResetSms}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('resetToDefault')}</TooltipContent>
                          </Tooltip>
                        </>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          {t('default')}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Textarea
                    value={smsMessage}
                    onChange={(e) => setSmsMessage(e.target.value)}
                    rows={5}
                    className="font-mono text-sm"
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t('smsVariables')}</span>
                    <span className={smsMessage.length > 160 ? 'text-amber-600 font-medium' : ''}>
                      {smsMessage.length}/160
                    </span>
                  </div>
                </div>
              </div>

              {/* SMS Preview */}
              <Collapsible open={showPreview} onOpenChange={setShowPreview}>
                <CollapsibleContent>
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                      {t('preview')}
                    </h3>
                    <div className="flex justify-center py-4">
                      <SmsPreview message={previewSms} storeName={store.name} />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </TabsContent>
          </Tabs>

          <SheetFooter className="mt-6 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleSave}>
              {tc('save')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  )
}
