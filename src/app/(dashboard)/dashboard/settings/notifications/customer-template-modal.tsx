'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Mail, Smartphone } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import type { CustomerNotificationEventType, CustomerNotificationTemplate } from '@/types/store'
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
    customer_request_received: 'Demande de reservation recue',
    customer_request_accepted: 'Votre demande de reservation a ete acceptee',
    customer_request_rejected: 'Votre demande de reservation n\'a pas pu etre acceptee',
    customer_reservation_confirmed: 'Confirmation de votre reservation #{number}',
    customer_reminder_pickup: 'Rappel: retrait de votre reservation demain',
    customer_reminder_return: 'Rappel: retour de votre reservation demain',
  },
  en: {
    customer_request_received: 'Reservation request received',
    customer_request_accepted: 'Your reservation request has been accepted',
    customer_request_rejected: 'Your reservation request could not be accepted',
    customer_reservation_confirmed: 'Confirmation of your reservation #{number}',
    customer_reminder_pickup: 'Reminder: pickup of your reservation tomorrow',
    customer_reminder_return: 'Reminder: return of your reservation tomorrow',
  },
  de: {
    customer_request_received: 'Reservierungsanfrage erhalten',
    customer_request_accepted: 'Ihre Reservierungsanfrage wurde akzeptiert',
    customer_request_rejected: 'Ihre Reservierungsanfrage konnte nicht akzeptiert werden',
    customer_reservation_confirmed: 'Bestatigung Ihrer Reservierung #{number}',
    customer_reminder_pickup: 'Erinnerung: Abholung Ihrer Reservierung morgen',
    customer_reminder_return: 'Erinnerung: Ruckgabe Ihrer Reservierung morgen',
  },
  es: {
    customer_request_received: 'Solicitud de reserva recibida',
    customer_request_accepted: 'Su solicitud de reserva ha sido aceptada',
    customer_request_rejected: 'Su solicitud de reserva no pudo ser aceptada',
    customer_reservation_confirmed: 'Confirmacion de su reserva #{number}',
    customer_reminder_pickup: 'Recordatorio: recogida de su reserva manana',
    customer_reminder_return: 'Recordatorio: devolucion de su reserva manana',
  },
  it: {
    customer_request_received: 'Richiesta di prenotazione ricevuta',
    customer_request_accepted: 'La tua richiesta di prenotazione e stata accettata',
    customer_request_rejected: 'La tua richiesta di prenotazione non e stata accettata',
    customer_reservation_confirmed: 'Conferma della tua prenotazione #{number}',
    customer_reminder_pickup: 'Promemoria: ritiro della tua prenotazione domani',
    customer_reminder_return: 'Promemoria: restituzione della tua prenotazione domani',
  },
  nl: {
    customer_request_received: 'Reserveringsaanvraag ontvangen',
    customer_request_accepted: 'Uw reserveringsaanvraag is geaccepteerd',
    customer_request_rejected: 'Uw reserveringsaanvraag kon niet worden geaccepteerd',
    customer_reservation_confirmed: 'Bevestiging van uw reservering #{number}',
    customer_reminder_pickup: 'Herinnering: ophalen van uw reservering morgen',
    customer_reminder_return: 'Herinnering: terugbrengen van uw reservering morgen',
  },
  pl: {
    customer_request_received: 'Otrzymano prosbe o rezerwacje',
    customer_request_accepted: 'Twoja prosba o rezerwacje zostala zaakceptowana',
    customer_request_rejected: 'Twoja prosba o rezerwacje nie mogla zostac zaakceptowana',
    customer_reservation_confirmed: 'Potwierdzenie rezerwacji #{number}',
    customer_reminder_pickup: 'Przypomnienie: odbior rezerwacji jutro',
    customer_reminder_return: 'Przypomnienie: zwrot rezerwacji jutro',
  },
  pt: {
    customer_request_received: 'Pedido de reserva recebido',
    customer_request_accepted: 'Seu pedido de reserva foi aceito',
    customer_request_rejected: 'Seu pedido de reserva nao pode ser aceito',
    customer_reservation_confirmed: 'Confirmacao da sua reserva #{number}',
    customer_reminder_pickup: 'Lembrete: retirada da sua reserva amanha',
    customer_reminder_return: 'Lembrete: devolucao da sua reserva amanha',
  },
}

// SMS templates per locale
const DEFAULT_SMS_TEMPLATES: Record<EmailLocale, Record<CustomerNotificationEventType, string>> = {
  fr: {
    customer_request_received: '{storeName}\nDemande recue #{number}\nNous reviendrons vers vous rapidement.',
    customer_request_accepted: '{storeName}\nDemande #{number} acceptee!\nRetrait le {startDate}',
    customer_request_rejected: '{storeName}\nDemande #{number} non disponible.\nContactez-nous pour plus d\'infos.',
    customer_reservation_confirmed: '{storeName}\nReservation #{number} confirmee\nDu {startDate} au {endDate}',
    customer_reminder_pickup: '{storeName}\nRappel: retrait demain\nReservation #{number}',
    customer_reminder_return: '{storeName}\nRappel: retour demain\nReservation #{number}',
  },
  en: {
    customer_request_received: '{storeName}\nRequest received #{number}\nWe will get back to you shortly.',
    customer_request_accepted: '{storeName}\nRequest #{number} accepted!\nPickup on {startDate}',
    customer_request_rejected: '{storeName}\nRequest #{number} unavailable.\nContact us for more info.',
    customer_reservation_confirmed: '{storeName}\nReservation #{number} confirmed\nFrom {startDate} to {endDate}',
    customer_reminder_pickup: '{storeName}\nReminder: pickup tomorrow\nReservation #{number}',
    customer_reminder_return: '{storeName}\nReminder: return tomorrow\nReservation #{number}',
  },
  de: {
    customer_request_received: '{storeName}\nAnfrage erhalten #{number}\nWir melden uns in Kurze.',
    customer_request_accepted: '{storeName}\nAnfrage #{number} akzeptiert!\nAbholung am {startDate}',
    customer_request_rejected: '{storeName}\nAnfrage #{number} nicht verfugbar.\nKontaktieren Sie uns.',
    customer_reservation_confirmed: '{storeName}\nReservierung #{number} bestatigt\nVom {startDate} bis {endDate}',
    customer_reminder_pickup: '{storeName}\nErinnerung: Abholung morgen\nReservierung #{number}',
    customer_reminder_return: '{storeName}\nErinnerung: Ruckgabe morgen\nReservierung #{number}',
  },
  es: {
    customer_request_received: '{storeName}\nSolicitud recibida #{number}\nLe responderemos pronto.',
    customer_request_accepted: '{storeName}\nSolicitud #{number} aceptada!\nRecogida el {startDate}',
    customer_request_rejected: '{storeName}\nSolicitud #{number} no disponible.\nContactenos para mas info.',
    customer_reservation_confirmed: '{storeName}\nReserva #{number} confirmada\nDel {startDate} al {endDate}',
    customer_reminder_pickup: '{storeName}\nRecordatorio: recogida manana\nReserva #{number}',
    customer_reminder_return: '{storeName}\nRecordatorio: devolucion manana\nReserva #{number}',
  },
  it: {
    customer_request_received: '{storeName}\nRichiesta ricevuta #{number}\nTi risponderemo presto.',
    customer_request_accepted: '{storeName}\nRichiesta #{number} accettata!\nRitiro il {startDate}',
    customer_request_rejected: '{storeName}\nRichiesta #{number} non disponibile.\nContattaci per info.',
    customer_reservation_confirmed: '{storeName}\nPrenotazione #{number} confermata\nDal {startDate} al {endDate}',
    customer_reminder_pickup: '{storeName}\nPromemoria: ritiro domani\nPrenotazione #{number}',
    customer_reminder_return: '{storeName}\nPromemoria: restituzione domani\nPrenotazione #{number}',
  },
  nl: {
    customer_request_received: '{storeName}\nAanvraag ontvangen #{number}\nWe nemen snel contact op.',
    customer_request_accepted: '{storeName}\nAanvraag #{number} geaccepteerd!\nOphalen op {startDate}',
    customer_request_rejected: '{storeName}\nAanvraag #{number} niet beschikbaar.\nNeem contact op.',
    customer_reservation_confirmed: '{storeName}\nReservering #{number} bevestigd\nVan {startDate} tot {endDate}',
    customer_reminder_pickup: '{storeName}\nHerinnering: ophalen morgen\nReservering #{number}',
    customer_reminder_return: '{storeName}\nHerinnering: terugbrengen morgen\nReservering #{number}',
  },
  pl: {
    customer_request_received: '{storeName}\nProśba otrzymana #{number}\nOdezwiemy sie wkrotce.',
    customer_request_accepted: '{storeName}\nProśba #{number} zaakceptowana!\nOdbior {startDate}',
    customer_request_rejected: '{storeName}\nProśba #{number} niedostepna.\nSkontaktuj sie z nami.',
    customer_reservation_confirmed: '{storeName}\nRezerwacja #{number} potwierdzona\nOd {startDate} do {endDate}',
    customer_reminder_pickup: '{storeName}\nPrzypomnienie: odbior jutro\nRezerwacja #{number}',
    customer_reminder_return: '{storeName}\nPrzypomnienie: zwrot jutro\nRezerwacja #{number}',
  },
  pt: {
    customer_request_received: '{storeName}\nPedido recebido #{number}\nEntraremos em contato em breve.',
    customer_request_accepted: '{storeName}\nPedido #{number} aceito!\nRetirada em {startDate}',
    customer_request_rejected: '{storeName}\nPedido #{number} indisponivel.\nEntre em contato.',
    customer_reservation_confirmed: '{storeName}\nReserva #{number} confirmada\nDe {startDate} a {endDate}',
    customer_reminder_pickup: '{storeName}\nLembrete: retirada amanha\nReserva #{number}',
    customer_reminder_return: '{storeName}\nLembrete: devolucao amanha\nReserva #{number}',
  },
}

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

  const [subject, setSubject] = useState(template?.subject || '')
  const [emailMessage, setEmailMessage] = useState(template?.emailMessage || '')
  const [smsMessage, setSmsMessage] = useState(template?.smsMessage || '')

  const defaultSubject = DEFAULT_SUBJECTS[locale]?.[eventType] || DEFAULT_SUBJECTS['en'][eventType]
  const defaultSms = DEFAULT_SMS_TEMPLATES[locale]?.[eventType] || DEFAULT_SMS_TEMPLATES['en'][eventType]

  const handleSave = () => {
    onSave({
      subject: subject || undefined,
      emailMessage: emailMessage || undefined,
      smsMessage: smsMessage || undefined,
    })
  }

  const handleReset = () => {
    setSubject('')
    setEmailMessage('')
    setSmsMessage('')
  }

  return (
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

            <div className="space-y-2">
              <Label className="text-xs">{t('subject')}</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={defaultSubject}
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {t('subjectHint')}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">{t('additionalMessage')}</Label>
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
              <Label className="text-xs">{t('smsMessage')}</Label>
              <Textarea
                value={smsMessage}
                onChange={(e) => setSmsMessage(e.target.value)}
                placeholder={defaultSms}
                rows={3}
                maxLength={160}
                className="text-sm font-mono"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t('smsVariables')}</span>
                <span className={smsMessage.length > 160 ? 'text-destructive' : ''}>
                  {smsMessage.length}/160
                </span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={handleReset}>
            {t('reset')}
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
  )
}
