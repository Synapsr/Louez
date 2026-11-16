'use client'

import { type FormEvent, useMemo, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'

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
import { KeyIcon } from '@louez/ui/icons'

interface TulipSetupSectionProps {
  connected: boolean
  renterUid: string | null
  connectedAt: string | null
  calendlyUrl: string
  isPending: boolean
  onConnect: (renterUid: string) => Promise<void>
}

export function TulipSetupSection({
  connected,
  renterUid,
  connectedAt,
  calendlyUrl,
  isPending,
  onConnect,
}: TulipSetupSectionProps) {
  const t = useTranslations('dashboard.settings.integrationsPage.assurance.setup')
  const format = useFormatter()
  const [inputRenterUid, setInputRenterUid] = useState('')

  const connectedDateLabel = useMemo(() => {
    if (!connectedAt) return null

    const parsed = new Date(connectedAt)
    if (Number.isNaN(parsed.getTime())) return null

    return format.dateTime(parsed, { dateStyle: 'medium', timeStyle: 'short' })
  }, [connectedAt, format])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const sanitized = inputRenterUid.trim()
    if (!sanitized) {
      return
    }

    await onConnect(sanitized)
    setInputRenterUid('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyIcon className="h-5 w-5 shrink-0" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={connected ? 'success' : 'expired'}>
            {connected ? t('statusConnected') : t('statusNotConnected')}
          </Badge>

          {connected && renterUid && (
            <span className="text-sm text-muted-foreground">
              {t('connectedWith', { renterUid })}
            </span>
          )}

          {connected && connectedDateLabel && (
            <span className="text-sm text-muted-foreground">
              {t('connectedAt', { date: connectedDateLabel })}
            </span>
          )}
        </div>

        {!connected && (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="tulip-renter-id">{t('apiKeyLabel')}</Label>
              <Input
                id="tulip-renter-id"
                type="text"
                placeholder={t('apiKeyPlaceholder')}
                value={inputRenterUid}
                onChange={(event) => setInputRenterUid(event.target.value)}
                disabled={isPending}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={isPending || inputRenterUid.trim().length === 0}>
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
        )}
      </CardContent>
    </Card>
  )
}
