'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Mail, Smartphone, RotateCcw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@louez/ui'
import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import { Textarea } from '@louez/ui'
import { Label } from '@louez/ui'
import { Badge } from '@louez/ui'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'
import type { CustomerNotificationEventType, CustomerNotificationTemplate } from '@louez/types'
import type { EmailLocale } from '@/lib/email/i18n'

interface CustomerTemplateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventType: CustomerNotificationEventType
  template?: CustomerNotificationTemplate
  onSave: (template: CustomerNotificationTemplate) => void
  locale: EmailLocale
}

// Default subjects per event type and locale
const DEFAULT_SUBJECTS: Record<EmailLocale, Record<CustomerNotificationEventType, string>> = {
  fr: {
    customer_request_received: 'Demande de réservation reçue',
    customer_request_accepted: 'Votre demande de réservation a été acceptée',
    customer_request_rejected: 'Votre demande de réservation n\'a pas pu être acceptée',
    customer_reservation_confirmed: 'Confirmation de votre réservation #{number}',
    customer_reminder_pickup: 'Rappel: retrait de votre réservation demain',
    customer_reminder_return: 'Rappel: retour de votre réservation demain',
    customer_payment_requested: 'Paiement demandé pour la réservation #{number}',
    customer_deposit_authorization_requested: 'Autorisation de caution pour la réservation #{number}',
  },
  en: {
    customer_request_received: 'Reservation request received',
    customer_request_accepted: 'Your reservation request has been accepted',
    customer_request_rejected: 'Your reservation request could not be accepted',
    customer_reservation_confirmed: 'Confirmation of your reservation #{number}',
    customer_reminder_pickup: 'Reminder: pickup of your reservation tomorrow',
    customer_reminder_return: 'Reminder: return of your reservation tomorrow',
    customer_payment_requested: 'Payment requested for reservation #{number}',
    customer_deposit_authorization_requested: 'Deposit authorization for reservation #{number}',
  },
  de: {
    customer_request_received: 'Reservierungsanfrage erhalten',
    customer_request_accepted: 'Ihre Reservierungsanfrage wurde akzeptiert',
    customer_request_rejected: 'Ihre Reservierungsanfrage konnte nicht akzeptiert werden',
    customer_reservation_confirmed: 'Bestätigung Ihrer Reservierung #{number}',
    customer_reminder_pickup: 'Erinnerung: Abholung Ihrer Reservierung morgen',
    customer_reminder_return: 'Erinnerung: Rückgabe Ihrer Reservierung morgen',
    customer_payment_requested: 'Zahlung angefordert für Reservierung #{number}',
    customer_deposit_authorization_requested: 'Kaution-Autorisierung für Reservierung #{number}',
  },
  es: {
    customer_request_received: 'Solicitud de reserva recibida',
    customer_request_accepted: 'Su solicitud de reserva ha sido aceptada',
    customer_request_rejected: 'Su solicitud de reserva no pudo ser aceptada',
    customer_reservation_confirmed: 'Confirmación de su reserva #{number}',
    customer_reminder_pickup: 'Recordatorio: recogida de su reserva mañana',
    customer_reminder_return: 'Recordatorio: devolución de su reserva mañana',
    customer_payment_requested: 'Pago solicitado para la reserva #{number}',
    customer_deposit_authorization_requested: 'Autorización de depósito para la reserva #{number}',
  },
  it: {
    customer_request_received: 'Richiesta di prenotazione ricevuta',
    customer_request_accepted: 'La tua richiesta di prenotazione è stata accettata',
    customer_request_rejected: 'La tua richiesta di prenotazione non è stata accettata',
    customer_reservation_confirmed: 'Conferma della tua prenotazione #{number}',
    customer_reminder_pickup: 'Promemoria: ritiro della tua prenotazione domani',
    customer_reminder_return: 'Promemoria: restituzione della tua prenotazione domani',
    customer_payment_requested: 'Pagamento richiesto per la prenotazione #{number}',
    customer_deposit_authorization_requested: 'Autorizzazione deposito per la prenotazione #{number}',
  },
  nl: {
    customer_request_received: 'Reserveringsaanvraag ontvangen',
    customer_request_accepted: 'Uw reserveringsaanvraag is geaccepteerd',
    customer_request_rejected: 'Uw reserveringsaanvraag kon niet worden geaccepteerd',
    customer_reservation_confirmed: 'Bevestiging van uw reservering #{number}',
    customer_reminder_pickup: 'Herinnering: ophalen van uw reservering morgen',
    customer_reminder_return: 'Herinnering: terugbrengen van uw reservering morgen',
    customer_payment_requested: 'Betaling gevraagd voor reservering #{number}',
    customer_deposit_authorization_requested: 'Borgautorisatie voor reservering #{number}',
  },
  pl: {
    customer_request_received: 'Otrzymano prośbę o rezerwację',
    customer_request_accepted: 'Twoja prośba o rezerwację została zaakceptowana',
    customer_request_rejected: 'Twoja prośba o rezerwację nie mogła zostać zaakceptowana',
    customer_reservation_confirmed: 'Potwierdzenie rezerwacji #{number}',
    customer_reminder_pickup: 'Przypomnienie: odbiór rezerwacji jutro',
    customer_reminder_return: 'Przypomnienie: zwrot rezerwacji jutro',
    customer_payment_requested: 'Płatność wymagana dla rezerwacji #{number}',
    customer_deposit_authorization_requested: 'Autoryzacja kaucji dla rezerwacji #{number}',
  },
  pt: {
    customer_request_received: 'Pedido de reserva recebido',
    customer_request_accepted: 'Seu pedido de reserva foi aceito',
    customer_request_rejected: 'Seu pedido de reserva não pode ser aceito',
    customer_reservation_confirmed: 'Confirmação da sua reserva #{number}',
    customer_reminder_pickup: 'Lembrete: retirada da sua reserva amanhã',
    customer_reminder_return: 'Lembrete: devolução da sua reserva amanhã',
    customer_payment_requested: 'Pagamento solicitado para a reserva #{number}',
    customer_deposit_authorization_requested: 'Autorização de caução para a reserva #{number}',
  },
}

// SMS templates per locale
const DEFAULT_SMS_TEMPLATES: Record<EmailLocale, Record<CustomerNotificationEventType, string>> = {
  fr: {
    customer_request_received: '{storeName}\nDemande reçue #{number}\nNous reviendrons vers vous rapidement.',
    customer_request_accepted: '{storeName}\nDemande #{number} acceptée!\nRetrait le {startDate}',
    customer_request_rejected: '{storeName}\nDemande #{number} non disponible.\nContactez-nous pour plus d\'infos.',
    customer_reservation_confirmed: '{storeName}\nRéservation #{number} confirmée\nDu {startDate} au {endDate}',
    customer_reminder_pickup: '{storeName}\nRappel: retrait demain\nRéservation #{number}',
    customer_reminder_return: '{storeName}\nRappel: retour demain\nRéservation #{number}',
    customer_payment_requested: '{storeName}\nPaiement de {amount} demandé pour #{number}\n{paymentUrl}',
    customer_deposit_authorization_requested: '{storeName}\nCaution de {amount} à autoriser pour #{number}\n{paymentUrl}',
  },
  en: {
    customer_request_received: '{storeName}\nRequest received #{number}\nWe will get back to you shortly.',
    customer_request_accepted: '{storeName}\nRequest #{number} accepted!\nPickup on {startDate}',
    customer_request_rejected: '{storeName}\nRequest #{number} unavailable.\nContact us for more info.',
    customer_reservation_confirmed: '{storeName}\nReservation #{number} confirmed\nFrom {startDate} to {endDate}',
    customer_reminder_pickup: '{storeName}\nReminder: pickup tomorrow\nReservation #{number}',
    customer_reminder_return: '{storeName}\nReminder: return tomorrow\nReservation #{number}',
    customer_payment_requested: '{storeName}\nPayment of {amount} requested for #{number}\n{paymentUrl}',
    customer_deposit_authorization_requested: '{storeName}\nDeposit of {amount} to authorize for #{number}\n{paymentUrl}',
  },
  de: {
    customer_request_received: '{storeName}\nAnfrage erhalten #{number}\nWir melden uns in Kürze.',
    customer_request_accepted: '{storeName}\nAnfrage #{number} akzeptiert!\nAbholung am {startDate}',
    customer_request_rejected: '{storeName}\nAnfrage #{number} nicht verfügbar.\nKontaktieren Sie uns.',
    customer_reservation_confirmed: '{storeName}\nReservierung #{number} bestätigt\nVom {startDate} bis {endDate}',
    customer_reminder_pickup: '{storeName}\nErinnerung: Abholung morgen\nReservierung #{number}',
    customer_reminder_return: '{storeName}\nErinnerung: Rückgabe morgen\nReservierung #{number}',
    customer_payment_requested: '{storeName}\nZahlung von {amount} für #{number} angefordert\n{paymentUrl}',
    customer_deposit_authorization_requested: '{storeName}\nKaution von {amount} für #{number} freizugeben\n{paymentUrl}',
  },
  es: {
    customer_request_received: '{storeName}\nSolicitud recibida #{number}\nLe responderemos pronto.',
    customer_request_accepted: '{storeName}\nSolicitud #{number} aceptada!\nRecogida el {startDate}',
    customer_request_rejected: '{storeName}\nSolicitud #{number} no disponible.\nContáctenos para más info.',
    customer_reservation_confirmed: '{storeName}\nReserva #{number} confirmada\nDel {startDate} al {endDate}',
    customer_reminder_pickup: '{storeName}\nRecordatorio: recogida mañana\nReserva #{number}',
    customer_reminder_return: '{storeName}\nRecordatorio: devolución mañana\nReserva #{number}',
    customer_payment_requested: '{storeName}\nPago de {amount} solicitado para #{number}\n{paymentUrl}',
    customer_deposit_authorization_requested: '{storeName}\nDepósito de {amount} a autorizar para #{number}\n{paymentUrl}',
  },
  it: {
    customer_request_received: '{storeName}\nRichiesta ricevuta #{number}\nTi risponderemo presto.',
    customer_request_accepted: '{storeName}\nRichiesta #{number} accettata!\nRitiro il {startDate}',
    customer_request_rejected: '{storeName}\nRichiesta #{number} non disponibile.\nContattaci per info.',
    customer_reservation_confirmed: '{storeName}\nPrenotazione #{number} confermata\nDal {startDate} al {endDate}',
    customer_reminder_pickup: '{storeName}\nPromemoria: ritiro domani\nPrenotazione #{number}',
    customer_reminder_return: '{storeName}\nPromemoria: restituzione domani\nPrenotazione #{number}',
    customer_payment_requested: '{storeName}\nPagamento di {amount} richiesto per #{number}\n{paymentUrl}',
    customer_deposit_authorization_requested: '{storeName}\nDeposito di {amount} da autorizzare per #{number}\n{paymentUrl}',
  },
  nl: {
    customer_request_received: '{storeName}\nAanvraag ontvangen #{number}\nWe nemen snel contact op.',
    customer_request_accepted: '{storeName}\nAanvraag #{number} geaccepteerd!\nOphalen op {startDate}',
    customer_request_rejected: '{storeName}\nAanvraag #{number} niet beschikbaar.\nNeem contact op.',
    customer_reservation_confirmed: '{storeName}\nReservering #{number} bevestigd\nVan {startDate} tot {endDate}',
    customer_reminder_pickup: '{storeName}\nHerinnering: ophalen morgen\nReservering #{number}',
    customer_reminder_return: '{storeName}\nHerinnering: terugbrengen morgen\nReservering #{number}',
    customer_payment_requested: '{storeName}\nBetaling van {amount} gevraagd voor #{number}\n{paymentUrl}',
    customer_deposit_authorization_requested: '{storeName}\nBorg van {amount} te autoriseren voor #{number}\n{paymentUrl}',
  },
  pl: {
    customer_request_received: '{storeName}\nProśba otrzymana #{number}\nOdezwiemy się wkrótce.',
    customer_request_accepted: '{storeName}\nProśba #{number} zaakceptowana!\nOdbiór {startDate}',
    customer_request_rejected: '{storeName}\nProśba #{number} niedostępna.\nSkontaktuj się z nami.',
    customer_reservation_confirmed: '{storeName}\nRezerwacja #{number} potwierdzona\nOd {startDate} do {endDate}',
    customer_reminder_pickup: '{storeName}\nPrzypomnienie: odbiór jutro\nRezerwacja #{number}',
    customer_reminder_return: '{storeName}\nPrzypomnienie: zwrot jutro\nRezerwacja #{number}',
    customer_payment_requested: '{storeName}\nPłatność {amount} wymagana dla #{number}\n{paymentUrl}',
    customer_deposit_authorization_requested: '{storeName}\nKaucja {amount} do autoryzacji dla #{number}\n{paymentUrl}',
  },
  pt: {
    customer_request_received: '{storeName}\nPedido recebido #{number}\nEntraremos em contato em breve.',
    customer_request_accepted: '{storeName}\nPedido #{number} aceito!\nRetirada em {startDate}',
    customer_request_rejected: '{storeName}\nPedido #{number} indisponível.\nEntre em contato.',
    customer_reservation_confirmed: '{storeName}\nReserva #{number} confirmada\nDe {startDate} a {endDate}',
    customer_reminder_pickup: '{storeName}\nLembrete: retirada amanhã\nReserva #{number}',
    customer_reminder_return: '{storeName}\nLembrete: devolução amanhã\nReserva #{number}',
    customer_payment_requested: '{storeName}\nPagamento de {amount} solicitado para #{number}\n{paymentUrl}',
    customer_deposit_authorization_requested: '{storeName}\nCaução de {amount} a autorizar para #{number}\n{paymentUrl}',
  },
}

// Export defaults for use in other files
export { DEFAULT_SUBJECTS, DEFAULT_SMS_TEMPLATES }

export function CustomerTemplateModal({
  open,
  onOpenChange,
  eventType,
  template,
  onSave,
  locale,
}: CustomerTemplateModalProps) {
  const t = useTranslations('dashboard.settings.notifications.customerTemplates')
  const tc = useTranslations('common')

  // Get defaults for current locale and event type
  const defaultSubject = useMemo(
    () => DEFAULT_SUBJECTS[locale]?.[eventType] || DEFAULT_SUBJECTS['en'][eventType],
    [locale, eventType]
  )
  const defaultSms = useMemo(
    () => DEFAULT_SMS_TEMPLATES[locale]?.[eventType] || DEFAULT_SMS_TEMPLATES['en'][eventType],
    [locale, eventType]
  )

  // Initialize with custom value if exists, otherwise default
  const [subject, setSubject] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [smsMessage, setSmsMessage] = useState('')

  // Reset state when modal opens or eventType changes
  useEffect(() => {
    if (open) {
      // Use custom template if exists, otherwise show default
      setSubject(template?.subject || defaultSubject)
      setEmailMessage(template?.emailMessage || '')
      setSmsMessage(template?.smsMessage || defaultSms)
    }
  }, [open, eventType, template, defaultSubject, defaultSms])

  // Check if values are customized (different from default)
  const isSubjectCustomized = subject !== defaultSubject
  const isSmsCustomized = smsMessage !== defaultSms
  const isEmailMessageCustomized = emailMessage.trim() !== ''

  const handleSave = () => {
    // Only save non-default values (save undefined to clear customization)
    onSave({
      subject: isSubjectCustomized ? subject : undefined,
      emailMessage: isEmailMessageCustomized ? emailMessage : undefined,
      smsMessage: isSmsCustomized ? smsMessage : undefined,
    })
  }

  const handleResetSubject = () => setSubject(defaultSubject)
  const handleResetSms = () => setSmsMessage(defaultSms)
  const handleResetEmailMessage = () => setEmailMessage('')

  const handleResetAll = () => {
    setSubject(defaultSubject)
    setEmailMessage('')
    setSmsMessage(defaultSms)
  }

  // Calculate SMS character count
  const smsCharCount = smsMessage.length

  return (
    <TooltipProvider>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{t('title')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Email Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Mail className="h-4 w-4" />
                {t('emailSection')}
              </div>

              {/* Subject field */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('subject')}</Label>
                  <div className="flex items-center gap-2">
                    {isSubjectCustomized ? (
                      <>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {t('customized')}
                        </Badge>
                        <Tooltip>
                          <TooltipTrigger render={<Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={handleResetSubject}
                            />}>
                              <RotateCcw className="h-3 w-3" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t('resetToDefault')}</p>
                          </TooltipContent>
                        </Tooltip>
                      </>
                    ) : (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                        {t('default')}
                      </Badge>
                    )}
                  </div>
                </div>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {t('subjectHint')}
                </p>
              </div>

              {/* Additional message field */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('additionalMessage')}</Label>
                  {isEmailMessageCustomized && (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {t('customized')}
                      </Badge>
                      <Tooltip>
                        <TooltipTrigger render={<Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={handleResetEmailMessage}
                          />}>
                            <RotateCcw className="h-3 w-3" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t('clearMessage')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>
                <Textarea
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                  placeholder={t('additionalMessagePlaceholder')}
                  rows={3}
                  className="text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {t('additionalMessageHint')}
                </p>
              </div>
            </div>

            {/* SMS Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Smartphone className="h-4 w-4" />
                {t('smsSection')}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('smsMessage')}</Label>
                  <div className="flex items-center gap-2">
                    {isSmsCustomized ? (
                      <>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {t('customized')}
                        </Badge>
                        <Tooltip>
                          <TooltipTrigger render={<Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={handleResetSms}
                            />}>
                              <RotateCcw className="h-3 w-3" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t('resetToDefault')}</p>
                          </TooltipContent>
                        </Tooltip>
                      </>
                    ) : (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                        {t('default')}
                      </Badge>
                    )}
                  </div>
                </div>
                <Textarea
                  value={smsMessage}
                  onChange={(e) => setSmsMessage(e.target.value)}
                  rows={4}
                  className="text-sm font-mono"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t('smsVariables')}</span>
                  <span className={smsCharCount > 160 ? 'text-destructive font-medium' : ''}>
                    {smsCharCount}/160
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={handleResetAll}>
              {t('resetAll')}
            </Button>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button size="sm" onClick={handleSave}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}
