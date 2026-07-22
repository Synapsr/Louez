'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  Check,
  ChevronDown,
  Copy,
  Loader2,
  MapPin,
  Phone,
  Search,
} from 'lucide-react'

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
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

/** ISO-3166 alpha-2 → flag emoji (regional indicator letters). */
function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
}

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
  const locale = useLocale()
  const router = useRouter()

  const regionNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' })
    } catch {
      return null
    }
  }, [locale])
  const countryLabel = (code: string) =>
    `${flagEmoji(code)} ${regionNames?.of(code) ?? code}`

  const [country, setCountry] = useState(
    (COUNTRIES as readonly string[]).includes(defaultCountry)
      ? defaultCountry
      : 'FR',
  )
  const [areaCode, setAreaCode] = useState('')
  const [results, setResults] = useState<AvailableNumber[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [showWebhook, setShowWebhook] = useState(false)
  const [copied, setCopied] = useState(false)
  const [manualNumber, setManualNumber] = useState('')

  /** Translate an 'errors.*' key, falling back to the raw key. */
  const showError = (key: string): string => {
    const short = key.replace(/^errors\./, '')
    return te.has(short) ? te(short) : key
  }

  // A server action that THROWS (not returns {error}) reaches onError — surface it
  // instead of failing silently.
  const onError = () => setError(showError('errors.unexpected'))

  const copyWebhook = () => {
    void navigator.clipboard?.writeText(webhookUrl).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }

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

  const busyNumber = provisionMutation.isPending
    ? provisionMutation.variables?.phoneNumber
    : null

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">{t('title')}</p>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {boundNumber ? (
        // Active number: keep it clean — the number and a guarded release, no
        // technical details (webhook, etc.) once a number is in place.
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
              <Phone className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-mono text-base font-semibold">
                  {boundNumber}
                </p>
                <Badge variant="success">{t('active')}</Badge>
              </div>
              <p className="text-muted-foreground text-xs">{t('activeHint')}</p>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  disabled={disabled || releaseMutation.isPending}
                />
              }
            >
              {isProvisioned ? t('release') : t('unlink')}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {isProvisioned
                    ? t('releaseConfirmTitle')
                    : t('unlinkConfirmTitle')}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {isProvisioned
                    ? t('releaseConfirmBody', { number: boundNumber })
                    : t('unlinkConfirmBody', { number: boundNumber })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="outline" />}>
                  {t('cancel')}
                </AlertDialogClose>
                <AlertDialogClose
                  render={<Button variant="destructive" />}
                  onClick={() => {
                    setError(null)
                    releaseMutation.mutate()
                  }}
                >
                  {isProvisioned ? t('release') : t('unlink')}
                </AlertDialogClose>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Step 1 — pick a country and search */}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label>{t('country')}</Label>
              <Select
                value={country}
                onValueChange={(value) => value && setCountry(value)}
              >
                {COUNTRIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {countryLabel(code)}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t('areaCode')}</Label>
              <Input
                value={areaCode}
                onChange={(event) => setAreaCode(event.target.value)}
                placeholder={t('areaCodePlaceholder')}
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

          {/* Step 2 — results / guidance */}
          {searchMutation.isPending ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('searching')}
            </div>
          ) : results === null ? (
            <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
              {t('searchHint')}
            </div>
          ) : results.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
              {t('noResults')}
            </div>
          ) : (
            <div className="space-y-2">
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
              <p className="text-muted-foreground text-xs">{t('costNote')}</p>
            </div>
          )}

          {/* Advanced, tucked away: link a number the merchant already owns */}
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
              <div className="mt-3 space-y-3">
                <div className="space-y-1.5">
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
                </div>

                {/* Webhook is a technical detail — hidden until asked for. */}
                <button
                  type="button"
                  onClick={() => setShowWebhook((value) => !value)}
                  className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                >
                  {t('manualSetup')}
                </button>
                {showWebhook && (
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs">
                      {t('manualHint')}
                    </p>
                    <div className="bg-muted/40 flex items-center gap-2 rounded-md border px-2 py-1.5">
                      <code className="flex-1 truncate text-xs">
                        {webhookUrl}
                      </code>
                      <button
                        type="button"
                        onClick={copyWebhook}
                        aria-label={t('copy')}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                      >
                        {copied ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
