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
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PhoneInput } from '@/components/ui/phone-input'
import {
  updateSinglePreference,
  updateDiscordWebhook,
  updateOwnerPhone,
  testDiscordWebhook,
} from './actions'
import type { NotificationSettings, NotificationEventType } from '@/types/store'

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
}

interface NotificationEvent {
  type: NotificationEventType
  category: 'reservation' | 'payment'
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

export function NotificationsForm({
  settings: initialSettings,
  discordWebhookUrl: initialWebhookUrl,
  ownerPhone: initialOwnerPhone,
  smsQuota,
}: NotificationsFormProps) {
  const t = useTranslations('dashboard.settings.notifications')
  const tc = useTranslations('common')

  const [settings, setSettings] = useState(initialSettings)
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState(initialWebhookUrl || '')
  const [ownerPhone, setOwnerPhone] = useState(initialOwnerPhone || '')
  const [isPending, startTransition] = useTransition()
  const [savingWebhook, setSavingWebhook] = useState(false)
  const [savingPhone, setSavingPhone] = useState(false)
  const [testingDiscord, setTestingDiscord] = useState(false)
  // Track connection state separately to update after save
  const [isDiscordConnected, setIsDiscordConnected] = useState(!!initialWebhookUrl)
  const [isSmsConfigured, setIsSmsConfigured] = useState(!!initialOwnerPhone)
  const smsLimitReached = !smsQuota.allowed
  const smsLow = smsQuota.limit !== null && smsQuota.current >= smsQuota.limit * 0.8

  const handleToggle = async (
    eventType: NotificationEventType,
    channel: 'email' | 'sms' | 'discord',
    enabled: boolean
  ) => {
    // Optimistic update
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
        // Revert on error
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

  const handleSaveWebhook = async () => {
    setSavingWebhook(true)
    const result = await updateDiscordWebhook(discordWebhookUrl || null)
    setSavingWebhook(false)

    if (result.error) {
      toast.error(t('discord.invalidUrl'))
    } else {
      // Update connection state after successful save
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
      // Update configured state and use normalized phone if returned
      const hasPhone = !!result.phone
      setIsSmsConfigured(hasPhone)
      if (result.phone) {
        setOwnerPhone(result.phone)
      }
      toast.success(t('phone.saved'))
    }
  }

  const reservationEvents = NOTIFICATION_EVENTS.filter((e) => e.category === 'reservation')
  const paymentEvents = NOTIFICATION_EVENTS.filter((e) => e.category === 'payment')

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Phone Number Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500 text-white">
                <Phone className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">{t('phone.title')}</CardTitle>
                <CardDescription>{t('phone.description')}</CardDescription>
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
              <Button onClick={handleSavePhone} disabled={savingPhone}>
                {savingPhone ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  tc('save')
                )}
              </Button>
            </div>
            {isSmsConfigured && (
              <p className="mt-2 text-sm text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" />
                {t('phone.configured')}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Discord Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500 text-white">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-base">{t('discord.title')}</CardTitle>
                <CardDescription>{t('discord.description')}</CardDescription>
              </div>
              {isDiscordConnected && (
                <span className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" />
                  {t('discord.connected')}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  type="url"
                  placeholder={t('discord.placeholder')}
                  value={discordWebhookUrl}
                  onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={handleSaveWebhook} disabled={savingWebhook}>
                  {savingWebhook ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    tc('save')
                  )}
                </Button>
                {isDiscordConnected && (
                  <Button
                    variant="outline"
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
                className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1"
              >
                {t('discord.howTo')}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </CardContent>
        </Card>

        {/* Reservation Events */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('events.reservation.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {/* Header */}
              <div className="flex items-center justify-between py-2 text-sm text-muted-foreground border-b">
                <span>{t('events.event')}</span>
                <div className="flex items-center gap-8">
                  <span className="w-12 text-center">Email</span>
                  <span className="w-12 text-center">SMS</span>
                  <span className="w-12 text-center">Discord</span>
                </div>
              </div>

              {/* Rows */}
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

        {/* Payment Events */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('events.payment.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {/* Header */}
              <div className="flex items-center justify-between py-2 text-sm text-muted-foreground border-b">
                <span>{t('events.event')}</span>
                <div className="flex items-center gap-8">
                  <span className="w-12 text-center">Email</span>
                  <span className="w-12 text-center">SMS</span>
                  <span className="w-12 text-center">Discord</span>
                </div>
              </div>

              {/* Rows */}
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
      </div>
    </TooltipProvider>
  )
}

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
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <div className="space-y-0.5 flex-1 min-w-0 pr-4">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className="text-xs text-muted-foreground truncate">{description}</p>
      </div>
      <div className="flex items-center gap-8 flex-shrink-0">
        {/* Email Toggle */}
        <div className="w-12 flex justify-center">
          <Switch
            checked={config.email}
            onCheckedChange={(checked) => onToggle(eventType, 'email', checked)}
            disabled={isPending}
          />
        </div>

        {/* SMS Toggle */}
        <div className="w-12 flex justify-center">
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

        {/* Discord Toggle */}
        <div className="w-12 flex justify-center">
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
