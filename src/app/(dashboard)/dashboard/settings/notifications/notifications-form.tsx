'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  Mail,
  Phone,
  MessageSquare,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Users,
  Bell,
  Pencil,
  Globe,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PhoneInput } from '@/components/ui/phone-input'
import { CustomerTemplateModal } from './customer-template-modal'
import {
  updateSinglePreference,
  updateDiscordWebhook,
  updateOwnerPhone,
  testDiscordWebhook,
  updateCustomerPreference,
  updateCustomerTemplate,
  getCustomerTemplate,
} from './actions'
import type {
  NotificationSettings,
  NotificationEventType,
  CustomerNotificationSettings,
  CustomerNotificationEventType,
  CustomerNotificationTemplate,
} from '@/types/store'
import type { EmailLocale } from '@/lib/email/i18n'

interface NotificationsFormProps {
  settings: NotificationSettings
  discordWebhookUrl: string | null
  ownerPhone: string | null
  smsQuota: {
    current: number
    limit: number | null
    prepaidBalance: number
    allowed: boolean
    totalAvailable: number
  }
  customerSettings: CustomerNotificationSettings
  storeLocale: EmailLocale
  storeLanguageName: string
}

interface NotificationEvent {
  type: NotificationEventType
  category: 'reservation' | 'payment'
}

interface CustomerNotificationEvent {
  type: CustomerNotificationEventType
  category: 'reservation' | 'reminder'
}

const NOTIFICATION_EVENTS: NotificationEvent[] = [
  { type: 'reservation_new', category: 'reservation' },
  { type: 'reservation_confirmed', category: 'reservation' },
  { type: 'reservation_rejected', category: 'reservation' },
  { type: 'reservation_cancelled', category: 'reservation' },
  { type: 'reservation_picked_up', category: 'reservation' },
  { type: 'reservation_completed', category: 'reservation' },
  { type: 'payment_received', category: 'payment' },
  { type: 'payment_failed', category: 'payment' },
]

const CUSTOMER_NOTIFICATION_EVENTS: CustomerNotificationEvent[] = [
  { type: 'customer_request_received', category: 'reservation' },
  { type: 'customer_request_accepted', category: 'reservation' },
  { type: 'customer_request_rejected', category: 'reservation' },
  { type: 'customer_reservation_confirmed', category: 'reservation' },
  { type: 'customer_reminder_pickup', category: 'reminder' },
  { type: 'customer_reminder_return', category: 'reminder' },
]

export function NotificationsForm({
  settings: initialSettings,
  discordWebhookUrl: initialWebhookUrl,
  ownerPhone: initialOwnerPhone,
  smsQuota,
  customerSettings: initialCustomerSettings,
  storeLocale,
  storeLanguageName,
}: NotificationsFormProps) {
  const t = useTranslations('dashboard.settings.notifications')
  const tc = useTranslations('common')

  // Admin notification state
  const [settings, setSettings] = useState(initialSettings)
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState(initialWebhookUrl || '')
  const [ownerPhone, setOwnerPhone] = useState(initialOwnerPhone || '')
  const [isPending, startTransition] = useTransition()
  const [savingWebhook, setSavingWebhook] = useState(false)
  const [savingPhone, setSavingPhone] = useState(false)
  const [testingDiscord, setTestingDiscord] = useState(false)
  const [isDiscordConnected, setIsDiscordConnected] = useState(!!initialWebhookUrl)
  const [isSmsConfigured, setIsSmsConfigured] = useState(!!initialOwnerPhone)

  // Customer notification state
  const [customerSettings, setCustomerSettings] = useState(initialCustomerSettings)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [editingEventType, setEditingEventType] = useState<CustomerNotificationEventType | null>(
    null
  )
  const [editingTemplate, setEditingTemplate] = useState<CustomerNotificationTemplate | null>(null)

  const smsLimitReached = !smsQuota.allowed
  const smsLow = smsQuota.limit !== null && smsQuota.current >= smsQuota.limit * 0.8

  // Admin toggle handler
  const handleToggle = async (
    eventType: NotificationEventType,
    channel: 'email' | 'sms' | 'discord',
    enabled: boolean
  ) => {
    setSettings((prev) => ({
      ...prev,
      [eventType]: {
        ...prev[eventType],
        [channel]: enabled,
      },
    }))

    startTransition(async () => {
      const result = await updateSinglePreference({ eventType, channel, enabled })
      if (result.error) {
        setSettings((prev) => ({
          ...prev,
          [eventType]: {
            ...prev[eventType],
            [channel]: !enabled,
          },
        }))
        toast.error(t('saveError'))
      }
    })
  }

  // Customer toggle handler
  const handleCustomerToggle = async (
    eventType: CustomerNotificationEventType,
    channel: 'email' | 'sms',
    enabled: boolean
  ) => {
    setCustomerSettings((prev) => ({
      ...prev,
      [eventType]: {
        ...prev[eventType],
        [channel]: enabled,
      },
    }))

    startTransition(async () => {
      const result = await updateCustomerPreference({ eventType, channel, enabled })
      if (result.error) {
        setCustomerSettings((prev) => ({
          ...prev,
          [eventType]: {
            ...prev[eventType],
            [channel]: !enabled,
          },
        }))
        toast.error(t('saveError'))
      }
    })
  }

  const handleSaveWebhook = async () => {
    setSavingWebhook(true)
    const result = await updateDiscordWebhook(discordWebhookUrl || null)
    setSavingWebhook(false)

    if (result.error) {
      toast.error(t('discord.invalidUrl'))
    } else {
      setIsDiscordConnected(!!discordWebhookUrl)
      toast.success(t('discord.saved'))
    }
  }

  const handleTestDiscord = async () => {
    setTestingDiscord(true)
    const result = await testDiscordWebhook()
    setTestingDiscord(false)

    if (result.error) {
      toast.error(t('discord.testError'))
    } else {
      toast.success(t('discord.testSuccess'))
    }
  }

  const handleSavePhone = async () => {
    setSavingPhone(true)
    const result = await updateOwnerPhone(ownerPhone || null)
    setSavingPhone(false)

    if (result.error) {
      toast.error(t('phone.invalidNumber'))
    } else {
      const hasPhone = !!result.phone
      setIsSmsConfigured(hasPhone)
      if (result.phone) {
        setOwnerPhone(result.phone)
      }
      toast.success(t('phone.saved'))
    }
  }

  const handleOpenTemplateModal = async (eventType: CustomerNotificationEventType) => {
    setEditingEventType(eventType)
    const result = await getCustomerTemplate(eventType)
    if (!result.error) {
      setEditingTemplate(result.template || {})
    }
    setTemplateModalOpen(true)
  }

  const handleSaveTemplate = async (template: CustomerNotificationTemplate) => {
    if (!editingEventType) return

    const result = await updateCustomerTemplate({
      eventType: editingEventType,
      template,
    })

    if (result.error) {
      toast.error(t('saveError'))
    } else {
      setCustomerSettings((prev) => ({
        ...prev,
        templates: {
          ...prev.templates,
          [editingEventType]: template,
        },
      }))
      toast.success(t('templateSaved'))
    }
    setTemplateModalOpen(false)
    setEditingEventType(null)
    setEditingTemplate(null)
  }

  const reservationEvents = NOTIFICATION_EVENTS.filter((e) => e.category === 'reservation')
  const paymentEvents = NOTIFICATION_EVENTS.filter((e) => e.category === 'payment')
  const customerReservationEvents = CUSTOMER_NOTIFICATION_EVENTS.filter(
    (e) => e.category === 'reservation'
  )
  const customerReminderEvents = CUSTOMER_NOTIFICATION_EVENTS.filter(
    (e) => e.category === 'reminder'
  )

  return (
    <TooltipProvider>
      <div className="space-y-8">
        {/* ================================================================ */}
        {/* ADMIN NOTIFICATIONS SECTION */}
        {/* ================================================================ */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{t('adminSection.title')}</h2>
              <p className="text-sm text-muted-foreground">{t('adminSection.description')}</p>
            </div>
          </div>

          {/* Phone Number Card */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                  <Phone className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm font-medium">{t('phone.title')}</CardTitle>
                  <CardDescription className="text-xs">{t('phone.description')}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 items-start">
                <PhoneInput
                  placeholder={t('phone.placeholder')}
                  value={ownerPhone}
                  onChange={setOwnerPhone}
                  className="max-w-xs"
                />
                <Button onClick={handleSavePhone} disabled={savingPhone} size="sm">
                  {savingPhone ? <Loader2 className="h-4 w-4 animate-spin" /> : tc('save')}
                </Button>
              </div>
              {isSmsConfigured && (
                <p className="mt-2 text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {t('phone.configured')}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Discord Card */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-sm font-medium">{t('discord.title')}</CardTitle>
                  <CardDescription className="text-xs">{t('discord.description')}</CardDescription>
                </div>
                {isDiscordConnected && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {t('discord.connected')}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    type="url"
                    placeholder={t('discord.placeholder')}
                    value={discordWebhookUrl}
                    onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                    className="flex-1 text-sm"
                  />
                  <Button onClick={handleSaveWebhook} disabled={savingWebhook} size="sm">
                    {savingWebhook ? <Loader2 className="h-4 w-4 animate-spin" /> : tc('save')}
                  </Button>
                  {isDiscordConnected && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleTestDiscord}
                      disabled={testingDiscord}
                    >
                      {testingDiscord ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        t('discord.test')
                      )}
                    </Button>
                  )}
                </div>
                <a
                  href="https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                >
                  {t('discord.howTo')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </CardContent>
          </Card>

          {/* Admin Reservation Events */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">{t('events.reservation.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="flex items-center justify-between py-2 text-xs text-muted-foreground border-b">
                  <span>{t('events.event')}</span>
                  <div className="flex items-center gap-6">
                    <span className="w-10 text-center">Email</span>
                    <span className="w-10 text-center">SMS</span>
                    <span className="w-10 text-center">Discord</span>
                  </div>
                </div>
                {reservationEvents.map((event) => (
                  <NotificationRow
                    key={event.type}
                    eventType={event.type}
                    label={t(`events.reservation.${event.type}.label`)}
                    description={t(`events.reservation.${event.type}.description`)}
                    config={settings[event.type]}
                    onToggle={handleToggle}
                    smsDisabled={!isSmsConfigured || smsLimitReached}
                    smsTooltip={
                      !isSmsConfigured
                        ? t('phone.required')
                        : smsLimitReached
                          ? t('sms.limitReached')
                          : undefined
                    }
                    discordDisabled={!isDiscordConnected}
                    discordTooltip={!isDiscordConnected ? t('discord.required') : undefined}
                    isPending={isPending}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Admin Payment Events */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">{t('events.payment.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="flex items-center justify-between py-2 text-xs text-muted-foreground border-b">
                  <span>{t('events.event')}</span>
                  <div className="flex items-center gap-6">
                    <span className="w-10 text-center">Email</span>
                    <span className="w-10 text-center">SMS</span>
                    <span className="w-10 text-center">Discord</span>
                  </div>
                </div>
                {paymentEvents.map((event) => (
                  <NotificationRow
                    key={event.type}
                    eventType={event.type}
                    label={t(`events.payment.${event.type}.label`)}
                    description={t(`events.payment.${event.type}.description`)}
                    config={settings[event.type]}
                    onToggle={handleToggle}
                    smsDisabled={!isSmsConfigured || smsLimitReached}
                    smsTooltip={
                      !isSmsConfigured
                        ? t('phone.required')
                        : smsLimitReached
                          ? t('sms.limitReached')
                          : undefined
                    }
                    discordDisabled={!isDiscordConnected}
                    discordTooltip={!isDiscordConnected ? t('discord.required') : undefined}
                    isPending={isPending}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Separator />

        {/* ================================================================ */}
        {/* CUSTOMER NOTIFICATIONS SECTION */}
        {/* ================================================================ */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 text-green-600">
              <Users className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold">{t('customerSection.title')}</h2>
              <p className="text-sm text-muted-foreground">{t('customerSection.description')}</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1.5 rounded-md">
              <Globe className="h-3.5 w-3.5" />
              <span>{storeLanguageName}</span>
            </div>
          </div>

          {/* Customer Reservation Events */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                {t('customerEvents.reservationTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="flex items-center justify-between py-2 text-xs text-muted-foreground border-b">
                  <span>{t('events.event')}</span>
                  <div className="flex items-center gap-4">
                    <span className="w-10 text-center">Email</span>
                    <span className="w-10 text-center">SMS</span>
                    <span className="w-8"></span>
                  </div>
                </div>
                {customerReservationEvents.map((event) => (
                  <CustomerNotificationRow
                    key={event.type}
                    eventType={event.type}
                    label={t(`customerEvents.${event.type}.label`)}
                    description={t(`customerEvents.${event.type}.description`)}
                    config={customerSettings[event.type]}
                    onToggle={handleCustomerToggle}
                    onEditTemplate={() => handleOpenTemplateModal(event.type)}
                    smsDisabled={smsLimitReached}
                    smsTooltip={smsLimitReached ? t('sms.limitReached') : undefined}
                    isPending={isPending}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Customer Reminder Events */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                {t('customerEvents.reminderTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="flex items-center justify-between py-2 text-xs text-muted-foreground border-b">
                  <span>{t('events.event')}</span>
                  <div className="flex items-center gap-4">
                    <span className="w-10 text-center">Email</span>
                    <span className="w-10 text-center">SMS</span>
                    <span className="w-8"></span>
                  </div>
                </div>
                {customerReminderEvents.map((event) => (
                  <CustomerNotificationRow
                    key={event.type}
                    eventType={event.type}
                    label={t(`customerEvents.${event.type}.label`)}
                    description={t(`customerEvents.${event.type}.description`)}
                    config={customerSettings[event.type]}
                    onToggle={handleCustomerToggle}
                    onEditTemplate={() => handleOpenTemplateModal(event.type)}
                    smsDisabled={smsLimitReached}
                    smsTooltip={smsLimitReached ? t('sms.limitReached') : undefined}
                    isPending={isPending}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* SMS Warning */}
        {(smsLimitReached || smsLow) && (
          <Alert variant={smsLimitReached ? 'destructive' : 'default'}>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>
                {smsLimitReached
                  ? t('sms.limitReachedMessage')
                  : t('sms.lowCredits', {
                      current: smsQuota.current,
                      limit: smsQuota.limit ?? 0,
                    })}
              </span>
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/sms">{t('sms.buyMore')}</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Template Modal */}
        {editingEventType && (
          <CustomerTemplateModal
            open={templateModalOpen}
            onOpenChange={setTemplateModalOpen}
            eventType={editingEventType}
            template={editingTemplate || undefined}
            onSave={handleSaveTemplate}
            locale={storeLocale}
          />
        )}
      </div>
    </TooltipProvider>
  )
}

// ============================================================================
// Admin Notification Row
// ============================================================================

interface NotificationRowProps {
  eventType: NotificationEventType
  label: string
  description: string
  config: { email: boolean; sms: boolean; discord: boolean }
  onToggle: (
    eventType: NotificationEventType,
    channel: 'email' | 'sms' | 'discord',
    enabled: boolean
  ) => void
  smsDisabled?: boolean
  smsTooltip?: string
  discordDisabled?: boolean
  discordTooltip?: string
  isPending?: boolean
}

function NotificationRow({
  eventType,
  label,
  description,
  config,
  onToggle,
  smsDisabled,
  smsTooltip,
  discordDisabled,
  discordTooltip,
  isPending,
}: NotificationRowProps) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b last:border-0">
      <div className="space-y-0.5 flex-1 min-w-0 pr-4">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className="text-xs text-muted-foreground truncate">{description}</p>
      </div>
      <div className="flex items-center gap-6 flex-shrink-0">
        <div className="w-10 flex justify-center">
          <Switch
            checked={config.email}
            onCheckedChange={(checked) => onToggle(eventType, 'email', checked)}
            disabled={isPending}
          />
        </div>
        <div className="w-10 flex justify-center">
          {smsDisabled && smsTooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Switch checked={config.sms} disabled />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{smsTooltip}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Switch
              checked={config.sms}
              onCheckedChange={(checked) => onToggle(eventType, 'sms', checked)}
              disabled={isPending || smsDisabled}
            />
          )}
        </div>
        <div className="w-10 flex justify-center">
          {discordDisabled && discordTooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Switch checked={config.discord} disabled />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{discordTooltip}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Switch
              checked={config.discord}
              onCheckedChange={(checked) => onToggle(eventType, 'discord', checked)}
              disabled={isPending || discordDisabled}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Customer Notification Row
// ============================================================================

interface CustomerNotificationRowProps {
  eventType: CustomerNotificationEventType
  label: string
  description: string
  config: { enabled: boolean; email: boolean; sms: boolean }
  onToggle: (
    eventType: CustomerNotificationEventType,
    channel: 'email' | 'sms',
    enabled: boolean
  ) => void
  onEditTemplate: () => void
  smsDisabled?: boolean
  smsTooltip?: string
  isPending?: boolean
}

function CustomerNotificationRow({
  eventType,
  label,
  description,
  config,
  onToggle,
  onEditTemplate,
  smsDisabled,
  smsTooltip,
  isPending,
}: CustomerNotificationRowProps) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b last:border-0">
      <div className="space-y-0.5 flex-1 min-w-0 pr-4">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className="text-xs text-muted-foreground truncate">{description}</p>
      </div>
      <div className="flex items-center gap-4 flex-shrink-0">
        <div className="w-10 flex justify-center">
          <Switch
            checked={config.email}
            onCheckedChange={(checked) => onToggle(eventType, 'email', checked)}
            disabled={isPending}
          />
        </div>
        <div className="w-10 flex justify-center">
          {smsDisabled && smsTooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Switch checked={config.sms} disabled />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{smsTooltip}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Switch
              checked={config.sms}
              onCheckedChange={(checked) => onToggle(eventType, 'sms', checked)}
              disabled={isPending || smsDisabled}
            />
          )}
        </div>
        <div className="w-8 flex justify-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onEditTemplate}
            title="Customize template"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
