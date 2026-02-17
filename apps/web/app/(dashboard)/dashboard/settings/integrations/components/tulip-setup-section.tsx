'use client'

import { type FormEvent, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@louez/ui'

interface TulipSetupSectionProps {
  connected: boolean
  apiKeyLast4: string | null
  connectedAt: string | null
  calendlyUrl: string
  isPending: boolean
  onConnect: (apiKey: string) => Promise<void>
}

export function TulipSetupSection({
  connected,
  apiKeyLast4,
  connectedAt,
  calendlyUrl,
  isPending,
  onConnect,
}: TulipSetupSectionProps) {
  const t = useTranslations('dashboard.settings.integrationsPage.assurance.setup')
  const [apiKey, setApiKey] = useState('')

  const connectedDateLabel = useMemo(() => {
    if (!connectedAt) return null

    const parsed = new Date(connectedAt)
    if (Number.isNaN(parsed.getTime())) return null

    return parsed.toLocaleString()
  }, [connectedAt])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const sanitized = apiKey.trim()
    if (!sanitized) {
      return
    }

    await onConnect(sanitized)
    setApiKey('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={connected ? 'success' : 'secondary'}>
            {connected ? t('statusConnected') : t('statusNotConnected')}
          </Badge>

          {connected && apiKeyLast4 && (
            <span className="text-sm text-muted-foreground">
              {t('connectedWith', { last4: apiKeyLast4 })}
            </span>
          )}

          {connected && connectedDateLabel && (
            <span className="text-sm text-muted-foreground">
              {t('connectedAt', { date: connectedDateLabel })}
            </span>
          )}
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="tulip-api-key">{t('apiKeyLabel')}</Label>
            <Input
              id="tulip-api-key"
              type="password"
              placeholder={t('apiKeyPlaceholder')}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isPending || apiKey.trim().length === 0}>
              {isPending ? t('validatingButton') : t('validateButton')}
            </Button>
            <Button
              type="button"
              variant="outline"
              render={<a href={calendlyUrl} target="_blank" rel="noreferrer" />}
            >
              {t('bookAppointmentButton')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
