'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Check,
  ChevronDown,
  Loader2,
  MapPin,
  Phone,
  Search,
  Trash2,
} from 'lucide-react'

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
  Select,
  SelectItem,
  toastManager,
} from '@louez/ui'

import {
  linkVoiceNumber,
  provisionVoiceNumber,
  releaseVoiceNumber,
  searchVoiceNumbers,
} from './voice-provisioning-actions'
import type { AvailableNumber } from '@/lib/voice/types'

// Countries the operator's telephony account most commonly serves. Extend as
// needed — the server accepts any ISO-3166 alpha-2 code.
const COUNTRIES = [
  'FR',
  'BE',
  'LU',
  'CH',
  'ES',
  'IT',
  'DE',
  'NL',
  'PT',
  'GB',
  'US',
  'CA',
] as const

interface VoiceNumberProvisioningProps {
  boundNumber: string | null
  /** True when the active number was provisioned by us (vs. manually linked). */
  isProvisioned: boolean
  webhookUrl: string
  defaultCountry: string
  disabled: boolean
}

export const VoiceNumberProvisioning = ({
  boundNumber,
  isProvisioned,
  webhookUrl,
  defaultCountry,
  disabled,
}: VoiceNumberProvisioningProps) => {
  const t = useTranslations('dashboard.settings.aiVoiceAgent.number')
  const te = useTranslations('errors')
  const router = useRouter()

  const [country, setCountry] = useState(
    (COUNTRIES as readonly string[]).includes(defaultCountry)
      ? defaultCountry
      : 'FR',
  )
  const [areaCode, setAreaCode] = useState('')
  const [results, setResults] = useState<AvailableNumber[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [manualNumber, setManualNumber] = useState('')

  /** Translate an 'errors.*' key, falling back to the raw key. */
  const showError = (key: string): string => {
    const short = key.replace(/^errors\./, '')
    return te.has(short) ? te(short) : key
  }

  // A server action that THROWS (not returns {error}) reaches onError — surface it
  // instead of failing silently.
  const onError = () => setError(showError('errors.unexpected'))

  const searchMutation = useMutation({
    mutationFn: searchVoiceNumbers,
    onError,
    onSuccess: (result) => {
      if ('error' in result) {
        setError(showError(result.error))
        setResults(null)
        return
      }
      setError(null)
      setResults(result.numbers)
    },
  })

  const provisionMutation = useMutation({
    mutationFn: provisionVoiceNumber,
    onError,
    onSuccess: (result) => {
      if ('error' in result) {
        setError(showError(result.error))
        return
      }
      toastManager.add({ title: t('provisioned'), type: 'success' })
      router.refresh()
    },
  })

  const linkMutation = useMutation({
    mutationFn: linkVoiceNumber,
    onError,
    onSuccess: (result) => {
      if ('error' in result) {
        setError(showError(result.error))
        return
      }
      toastManager.add({ title: t('linked'), type: 'success' })
      router.refresh()
    },
  })

  const releaseMutation = useMutation({
    mutationFn: releaseVoiceNumber,
    onError,
    onSuccess: (result) => {
      if ('error' in result) {
        setError(showError(result.error))
        return
      }
      toastManager.add({ title: t('released'), type: 'success' })
      router.refresh()
    },
  })

  const busyNumber =
    provisionMutation.isPending ? provisionMutation.variables?.phoneNumber : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {boundNumber ? (
          <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Badge variant="success">{t('active')}</Badge>
              <div>
                <p className="font-mono text-sm font-semibold">{boundNumber}</p>
                <p className="text-muted-foreground text-xs">
                  {t('activeHint')}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || releaseMutation.isPending}
              onClick={() => {
                setError(null)
                releaseMutation.mutate()
              }}
              className="gap-2 text-destructive"
            >
              {releaseMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {isProvisioned ? t('release') : t('unlink')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="grid gap-1.5">
                <Label>{t('country')}</Label>
                <Select
                  value={country}
                  onValueChange={(value) => value && setCountry(value)}
                >
                  {COUNTRIES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <div className="grid flex-1 gap-1.5">
                <Label>{t('areaCode')}</Label>
                <Input
                  value={areaCode}
                  onChange={(event) => setAreaCode(event.target.value)}
                  placeholder="75"
                  inputMode="numeric"
                />
              </div>
              <Button
                type="button"
                disabled={disabled || searchMutation.isPending}
                onClick={() => {
                  setError(null)
                  searchMutation.mutate({ country, areaCode })
                }}
                className="gap-2"
              >
                {searchMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {t('search')}
              </Button>
            </div>

            {results !== null && results.length === 0 && (
              <p className="text-muted-foreground text-sm">{t('noResults')}</p>
            )}

            {results && results.length > 0 && (
              <div className="divide-y rounded-lg border">
                {results.map((number) => (
                  <div
                    key={number.phoneNumber}
                    className="flex items-center justify-between gap-3 p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold">
                        {number.phoneNumber}
                      </p>
                      {(number.locality || number.region) && (
                        <p className="text-muted-foreground flex items-center gap-1 text-xs">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {[number.locality, number.region]
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      disabled={disabled || provisionMutation.isPending}
                      onClick={() => {
                        setError(null)
                        provisionMutation.mutate({
                          phoneNumber: number.phoneNumber,
                        })
                      }}
                      className="gap-2"
                    >
                      {busyNumber === number.phoneNumber ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      {t('provision')}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-muted-foreground text-xs">{t('costNote')}</p>

            {/* Advanced: link a number the merchant already owns */}
            <div className="border-t pt-3">
              <button
                type="button"
                onClick={() => setShowManual((value) => !value)}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    showManual ? 'rotate-180' : ''
                  }`}
                />
                {t('advanced')}
              </button>
              {showManual && (
                <div className="mt-3 space-y-2">
                  <Label>{t('manualNumber')}</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={manualNumber}
                      onChange={(event) => setManualNumber(event.target.value)}
                      placeholder="+33123456789"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        disabled ||
                        linkMutation.isPending ||
                        manualNumber.trim().length === 0
                      }
                      onClick={() => {
                        setError(null)
                        linkMutation.mutate({ phoneNumber: manualNumber.trim() })
                      }}
                    >
                      {linkMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {t('link')}
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t('manualHint', { url: webhookUrl })}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
