'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Mail, Send, CheckCircle, XCircle, Package, ArrowDownRight, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SettingsNav } from '@/components/dashboard/settings-nav'
import { updateEmailSettings, getEmailSettings } from './actions'
import type { EmailSettings, EmailCustomContent } from '@/types/store'

interface EmailTypeConfig {
  key: 'confirmationContent' | 'rejectionContent' | 'pickupReminderContent' | 'returnReminderContent' | 'requestAcceptedContent'
  icon: React.ReactNode
  iconBg: string
  toggleKey: 'confirmationEnabled' | 'reminderPickupEnabled' | 'reminderReturnEnabled' | null
  defaultSubject: string
  defaultTitle: string
  defaultBody: string
  defaultClosing: string
}

export default function EmailSettingsPage() {
  const t = useTranslations('dashboard.settings.emailSettings')
  const tEmails = useTranslations('emails')
  const tc = useTranslations('common')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const [settings, setSettings] = useState<EmailSettings>({
    confirmationEnabled: true,
    reminderPickupEnabled: true,
    reminderReturnEnabled: true,
    replyToEmail: null,
    defaultSignature: '',
    confirmationContent: {},
    rejectionContent: {},
    pickupReminderContent: {},
    returnReminderContent: {},
    requestAcceptedContent: {},
  })

  const emailTypes: EmailTypeConfig[] = [
    {
      key: 'confirmationContent',
      icon: <Send className="h-4 w-4" />,
      iconBg: 'bg-blue-500',
      toggleKey: 'confirmationEnabled',
      defaultSubject: tEmails('confirmReservation.subject', { number: '0001' }),
      defaultTitle: tEmails('confirmReservation.title'),
      defaultBody: tEmails('confirmReservation.body', { number: '0001' }),
      defaultClosing: tEmails('common.team', { storeName: 'Votre boutique' }),
    },
    {
      key: 'requestAcceptedContent',
      icon: <CheckCircle className="h-4 w-4" />,
      iconBg: 'bg-green-500',
      toggleKey: null,
      defaultSubject: tEmails('requestAccepted.subject', { number: '0001' }),
      defaultTitle: tEmails('requestAccepted.title'),
      defaultBody: tEmails('requestAccepted.body', { number: '0001' }),
      defaultClosing: tEmails('common.team', { storeName: 'Votre boutique' }),
    },
    {
      key: 'rejectionContent',
      icon: <XCircle className="h-4 w-4" />,
      iconBg: 'bg-red-500',
      toggleKey: null,
      defaultSubject: tEmails('requestRejected.subject', { number: '0001' }),
      defaultTitle: tEmails('requestRejected.title'),
      defaultBody: tEmails('requestRejected.body', { number: '0001' }),
      defaultClosing: tEmails('common.team', { storeName: 'Votre boutique' }),
    },
    {
      key: 'pickupReminderContent',
      icon: <Package className="h-4 w-4" />,
      iconBg: 'bg-amber-500',
      toggleKey: 'reminderPickupEnabled',
      defaultSubject: tEmails('reminderPickup.subject'),
      defaultTitle: tEmails('reminderPickup.title'),
      defaultBody: tEmails('reminderPickup.body', { number: '0001' }),
      defaultClosing: tEmails('reminderPickup.seeTomorrow'),
    },
    {
      key: 'returnReminderContent',
      icon: <ArrowDownRight className="h-4 w-4" />,
      iconBg: 'bg-purple-500',
      toggleKey: 'reminderReturnEnabled',
      defaultSubject: tEmails('reminderReturn.subject'),
      defaultTitle: tEmails('reminderReturn.title'),
      defaultBody: tEmails('reminderReturn.body', { number: '0001' }),
      defaultClosing: tEmails('reminderReturn.thanks'),
    },
  ]

  useEffect(() => {
    async function loadSettings() {
      const result = await getEmailSettings()
      if (result.settings) {
        setSettings(result.settings)
      }
      setLoading(false)
    }
    loadSettings()
  }, [])

  const handleToggle = (key: keyof EmailSettings, value: boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  const handleMessageChange = (
    emailType: EmailTypeConfig['key'],
    value: string
  ) => {
    setSettings(prev => ({
      ...prev,
      [emailType]: {
        ...(prev[emailType] || {}),
        message: value || undefined,
      },
    }))
  }

  const handleSubmit = async () => {
    setSaving(true)
    const result = await updateEmailSettings(settings)
    if (result.success) {
      toast.success(t('saved'))
    } else {
      toast.error(result.error || t('saveError'))
    }
    setSaving(false)
  }

  const isEnabled = (emailType: EmailTypeConfig) => {
    if (!emailType.toggleKey) return true
    return settings[emailType.toggleKey]
  }

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <SettingsNav />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      <SettingsNav />

      {/* Email Cards */}
      <div className="space-y-4">
        {emailTypes.map((emailType) => {
          const customMessage = (settings[emailType.key] as EmailCustomContent)?.message
          const isExpanded = expandedCard === emailType.key
          const enabled = isEnabled(emailType)

          return (
            <Card
              key={emailType.key}
              className={!enabled ? 'opacity-60' : undefined}
            >
              <Collapsible
                open={isExpanded}
                onOpenChange={(open) => setExpandedCard(open ? emailType.key : null)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-white ${emailType.iconBg}`}>
                        {emailType.icon}
                      </div>
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {t(`emailTypes.${emailType.key}`)}
                          {customMessage && (
                            <Badge variant="secondary" className="text-xs">
                              {t('customized')}
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                          {t(`emailTypes.${emailType.key}Description`)}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {emailType.toggleKey && (
                        <Switch
                          checked={enabled}
                          onCheckedChange={(checked) => handleToggle(emailType.toggleKey!, checked)}
                        />
                      )}
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                  </div>
                </CardHeader>

                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-4">
                    {/* Email Preview */}
                    <div className="rounded-lg border bg-muted/30 overflow-hidden">
                      {/* Email Header Preview */}
                      <div className="bg-muted/50 px-4 py-2 border-b">
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">{t('preview.subject')}:</span> {emailType.defaultSubject}
                        </p>
                      </div>

                      {/* Email Body Preview */}
                      <div className="p-4 space-y-3">
                        <div className="flex items-center gap-2 pb-3 border-b">
                          <div className="h-8 w-8 rounded bg-primary/20 flex items-center justify-center">
                            <Mail className="h-4 w-4 text-primary" />
                          </div>
                          <span className="font-medium text-sm">{t('preview.yourStore')}</span>
                        </div>

                        <h3 className="font-semibold text-lg">{emailType.defaultTitle}</h3>

                        <p className="text-sm text-muted-foreground">
                          {tEmails('common.greeting', { name: 'Jean' })}
                        </p>

                        <p className="text-sm">{emailType.defaultBody}</p>

                        {/* Custom Message Section */}
                        {customMessage ? (
                          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                            <p className="text-sm whitespace-pre-line">{customMessage}</p>
                          </div>
                        ) : (
                          <div className="bg-muted/50 border border-dashed rounded-lg p-3">
                            <p className="text-sm text-muted-foreground italic">
                              {t('preview.noCustomMessage')}
                            </p>
                          </div>
                        )}

                        <p className="text-sm pt-2">{emailType.defaultClosing}</p>
                      </div>
                    </div>

                    {/* Custom Message Input */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        {t('customMessage')}
                      </label>
                      <Textarea
                        placeholder={t('customMessagePlaceholder')}
                        value={customMessage || ''}
                        onChange={(e) => handleMessageChange(emailType.key, e.target.value)}
                        rows={3}
                        className="resize-none"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('customMessageHint')}
                      </p>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          )
        })}
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {tc('loading')}
            </>
          ) : (
            tc('save')
          )}
        </Button>
      </div>
    </div>
  )
}
