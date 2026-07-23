'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { revalidateLogic, useStore } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import {
  ArrowRight,
  Clock3,
  CreditCard,
  Lock,
  Phone,
  PhoneCall,
  TriangleAlert,
  Voicemail,
  Wallet,
  Zap,
} from 'lucide-react'

import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SelectItem,
  Switch,
  toastManager,
} from '@louez/ui'
import {
  AI_PHONE_GREETING_MAX_LENGTH,
  AI_PHONE_LANGUAGES,
  defaultAiPhoneSettings,
} from '@louez/validations'
import type { AiPhoneSettings } from '@louez/types'

import { updateAiPhoneSettings } from './phone-actions'
import { FeaturePresentation } from './feature-presentation'
import { OPEN_TOPUP_EVENT } from './ai-assistant-header'
import { VoiceNumberProvisioning } from './voice-number-provisioning'
import { VoicePicker } from './voice-picker'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'
import { FormRadioCardGroup } from '@/components/form/form-radio-card-group'
import { RootError } from '@/components/form/root-error'
import { useAppForm } from '@/hooks/form/form'
import { localeFlags, localeNames } from '@/i18n/config'

// Light client-side format check; the server does the authoritative E.164
// validation (libphonenumber) so we don't ship that metadata to the browser.
const E164_RE = /^\+[1-9]\d{6,15}$/

const createAiPhoneSettingsSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string,
  tValidation: (
    key: string,
    params?: Record<string, string | number | Date>,
  ) => string,
) =>
  z.object({
    enabled: z.boolean(),
    language: z.enum(AI_PHONE_LANGUAGES),
    voice: z.string(),
    canTakeReservations: z.boolean(),
    recordCalls: z.boolean(),
    answerMode: z.enum(['always', 'after_hours']),
    greeting: z
      .string()
      .max(
        AI_PHONE_GREETING_MAX_LENGTH,
        tValidation('maxLength', { max: AI_PHONE_GREETING_MAX_LENGTH }),
      ),
    transferNumber: z
      .string()
      .refine((value) => value === '' || E164_RE.test(value), t('phoneFormat')),
  })

interface VoiceAgentFormProps {
  store: { id: string; aiPhoneSettings: AiPhoneSettings | null }
  hasFeatureAccess: boolean
  phoneConfigured: boolean
  boundNumber: string | null
  isProvisioned: boolean
  webhookUrl: string
  defaultCountry: string
  /** Monthly number rental in credits (null = free / not configured). */
  numberRentalCredits: number | null
  /** Flat voice tariff in credits per minute (null = not configured). */
  voiceCreditsPerMinute: number | null
  /** Whether the balance covers one rental cycle (drives the recharge nudge). */
  hasRentalFunds: boolean
}

export const VoiceAgentForm = ({
  store,
  hasFeatureAccess,
  phoneConfigured,
  boundNumber,
  isProvisioned,
  webhookUrl,
  defaultCountry,
  numberRentalCredits,
  voiceCreditsPerMinute,
  hasRentalFunds,
}: VoiceAgentFormProps) => {
  const router = useRouter()
  const t = useTranslations('dashboard.settings.aiVoiceAgent')
  const tAdvisor = useTranslations('dashboard.settings.aiAdvisor')
  const tValidation = useTranslations('validation')
  const tCommon = useTranslations('common')

  const schema = createAiPhoneSettingsSchema(t, tValidation)
  const current = store.aiPhoneSettings || defaultAiPhoneSettings

  const [rootError, setRootError] = useState<string | null>(null)
  // Turning the agent off detaches the bound number — confirmed via a dialog.
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false)
  const updateMutation = useMutation({ mutationFn: updateAiPhoneSettings })

  const form = useAppForm({
    defaultValues: {
      enabled: current.enabled,
      // Persisted locale string coerced to the known set; the Zod schema below
      // and the server action re-validate it, so an unknown value can't slip in.
      language: current.language as (typeof AI_PHONE_LANGUAGES)[number],
      voice: current.voice || '',
      canTakeReservations: current.canTakeReservations,
      recordCalls: current.recordCalls ?? false,
      answerMode: current.answerMode,
      greeting: current.greeting || '',
      transferNumber: current.transferNumber || '',
    },
    validators: { onSubmit: schema },
    validationLogic: revalidateLogic({
      mode: 'submit',
      modeAfterSubmission: 'change',
    }),
    onSubmit: async ({ value }) => {
      setRootError(null)
      const result = await updateMutation.mutateAsync(value)
      if (result.error) {
        setRootError(result.error)
        return
      }
      if (result.warning === 'numberReleaseFailed') {
        // Saved, but the number could not be handed back: tell the owner it is
        // still attached (the daily job retries the cleanup).
        toastManager.add({ title: t('numberReleaseFailed'), type: 'warning' })
      }
      toastManager.add({ title: t('saved'), type: 'success' })
      form.options.defaultValues = value
      form.reset()
      router.refresh()
    },
  })

  const isDirty = useStore(form.store, (s) => s.isDirty)
  const isEnabled = useStore(form.store, (s) => s.values.enabled)
  // The voice preview is generated in the currently selected language.
  const selectedLanguage = useStore(form.store, (s) => s.values.language)

  // Locked state for plans without access — reuses the advisor upgrade copy.
  if (!hasFeatureAccess) {
    return (
      <Card className="relative overflow-hidden">
        <div className="absolute inset-0 bg-background/80 backdrop-blur-[2px] z-10 flex items-center justify-center">
          <div className="text-center p-6">
            <Lock className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium">{tAdvisor('locked.featureLocked')}</p>
            <Button
              onClick={() => router.push('/dashboard/subscription')}
              className="gap-2 mt-3"
            >
              <Zap className="h-4 w-4" />
              {tAdvisor('locked.upgrade')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            {t('enableSection')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 opacity-50 pointer-events-none">
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <span className="text-sm">{t('enabled')}</span>
            <Switch disabled />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <form.AppForm>
      <form.Form className="space-y-6">
        <RootError error={rootError} />

        {!phoneConfigured && (
          <Alert variant="warning">
            <TriangleAlert />
            <AlertTitle>{t('notConfigured.title')}</AlertTitle>
            <AlertDescription>{t('notConfigured.description')}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              {t('enableSection')}
            </CardTitle>
            <CardDescription>{t('enableSectionDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Enabled switch — turning OFF with a bound number asks for
                confirmation, because saving then detaches the number. */}
            <form.Field name="enabled">
              {(field) => (
                <>
                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{t('enabled')}</p>
                      <p className="text-muted-foreground text-sm">
                        {t('enabledDescription')}
                      </p>
                    </div>
                    <Switch
                      checked={field.state.value}
                      onCheckedChange={(next) => {
                        if (!next && boundNumber) {
                          setConfirmDisableOpen(true)
                          return
                        }
                        field.handleChange(next)
                      }}
                    />
                  </div>

                  <AlertDialog
                    open={confirmDisableOpen}
                    onOpenChange={setConfirmDisableOpen}
                  >
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t('disableConfirm.title')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('disableConfirm.description', {
                            number: boundNumber ?? '',
                          })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogClose>{tCommon('cancel')}</AlertDialogClose>
                        <Button
                          variant="destructive"
                          onClick={() => {
                            field.handleChange(false)
                            setConfirmDisableOpen(false)
                          }}
                        >
                          {t('disableConfirm.confirm')}
                        </Button>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </form.Field>

            {/* What the voice agent does — sell it before it is turned on,
                with the tariffs stated as plain facts. */}
            {!isEnabled && (
              <FeaturePresentation
                variant="voice"
                chips={[
                  ...(numberRentalCredits !== null
                    ? [t('setup.rentalChip', { credits: numberRentalCredits })]
                    : []),
                  ...(voiceCreditsPerMinute !== null
                    ? [
                        t('setup.perMinuteChip', {
                          credits: voiceCreditsPerMinute,
                        }),
                      ]
                    : []),
                ]}
                onActivate={() => form.setFieldValue('enabled', true)}
              />
            )}

            {/* Step 1 of 2 — the agent needs a line before anything else: pick
                (or link) the number, with the rental terms stated upfront. */}
            {isEnabled && !boundNumber && (
              <div className="space-y-4 border-t pt-6">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="bg-primary text-primary-foreground flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold">
                    1
                  </span>
                  <span className="font-medium">{t('setup.step1')}</span>
                  <span className="text-muted-foreground/60 mx-1">—</span>
                  <span className="bg-muted text-muted-foreground flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold">
                    2
                  </span>
                  <span className="text-muted-foreground">
                    {t('setup.step2')}
                  </span>
                </div>

                <div className="bg-muted/40 space-y-3 rounded-lg border p-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                      <PhoneCall className="h-4 w-4" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{t('setup.title')}</p>
                      <p className="text-muted-foreground text-sm">
                        {t('setup.why')}
                      </p>
                    </div>
                  </div>

                  {(numberRentalCredits !== null ||
                    voiceCreditsPerMinute !== null) && (
                    <div className="flex flex-wrap gap-2">
                      {numberRentalCredits !== null && (
                        <Badge variant="secondary" className="gap-1.5">
                          <Wallet className="h-3 w-3" />
                          {t('setup.rentalChip', {
                            credits: numberRentalCredits,
                          })}
                        </Badge>
                      )}
                      {voiceCreditsPerMinute !== null && (
                        <Badge variant="secondary" className="gap-1.5">
                          <Clock3 className="h-3 w-3" />
                          {t('setup.perMinuteChip', {
                            credits: voiceCreditsPerMinute,
                          })}
                        </Badge>
                      )}
                    </div>
                  )}

                  {numberRentalCredits !== null && !hasRentalFunds && (
                    <Alert variant="warning">
                      <TriangleAlert />
                      <AlertTitle>{t('setup.insufficientTitle')}</AlertTitle>
                      <AlertDescription className="space-y-2">
                        <p>
                          {t('setup.insufficientBody', {
                            credits: numberRentalCredits,
                          })}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          className="gap-1.5"
                          onClick={() =>
                            window.dispatchEvent(new Event(OPEN_TOPUP_EVENT))
                          }
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                          {t('setup.insufficientCta')}
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <VoiceNumberProvisioning
                  boundNumber={boundNumber}
                  isProvisioned={isProvisioned}
                  webhookUrl={webhookUrl}
                  defaultCountry={defaultCountry}
                  disabled={!phoneConfigured}
                />

                <p className="text-muted-foreground text-sm">
                  {t('setup.step2Hint')}
                </p>
              </div>
            )}

            {isEnabled && boundNumber && (
              <div className="space-y-6 border-t pt-6">
                {/* Inbound number: provision, link or release — part of the agent */}
                <VoiceNumberProvisioning
                  boundNumber={boundNumber}
                  isProvisioned={isProvisioned}
                  webhookUrl={webhookUrl}
                  defaultCountry={defaultCountry}
                  disabled={!phoneConfigured}
                />

                {(numberRentalCredits !== null ||
                  voiceCreditsPerMinute !== null) && (
                  <div className="text-muted-foreground -mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                    <Wallet className="h-3 w-3" />
                    {[
                      numberRentalCredits !== null
                        ? t('setup.boundRental', {
                            credits: numberRentalCredits,
                          })
                        : null,
                      voiceCreditsPerMinute !== null
                        ? t('setup.perMinuteChip', {
                            credits: voiceCreditsPerMinute,
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}

                {/* Language */}
                <form.AppField name="language">
                  {(field) => (
                    <field.Select
                      label={t('language')}
                      description={t('languageDescription')}
                      renderValue={(value) =>
                        `${localeFlags[value as (typeof AI_PHONE_LANGUAGES)[number]]} ${
                          localeNames[value as (typeof AI_PHONE_LANGUAGES)[number]]
                        }`
                      }
                    >
                      {AI_PHONE_LANGUAGES.map((code) => (
                        <SelectItem key={code} value={code}>
                          {localeFlags[code]} {localeNames[code]}
                        </SelectItem>
                      ))}
                    </field.Select>
                  )}
                </form.AppField>

                {/* Voice — choose (male/female) and preview it */}
                <form.Field name="voice">
                  {(field) => (
                    <VoicePicker
                      value={field.state.value}
                      onChange={(id) => field.handleChange(id)}
                      language={selectedLanguage}
                    />
                  )}
                </form.Field>

                {/* Can take reservations */}
                <form.AppField name="canTakeReservations">
                  {(field) => (
                    <field.Switch
                      label={t('canTakeReservations')}
                      description={t('canTakeReservationsDescription')}
                    />
                  )}
                </form.AppField>

                {/* Answer mode */}
                <form.Field name="answerMode">
                  {(field) => (
                    <FormRadioCardGroup
                      value={field.state.value}
                      onChange={(next) => field.handleChange(next)}
                      label={t('answerMode')}
                      helpText={t('answerModeDescription')}
                      options={[
                        {
                          value: 'always',
                          label: t('answerModeAlways'),
                          description: t('answerModeAlwaysDescription'),
                          icon: <PhoneCall className="h-4 w-4" />,
                        },
                        {
                          value: 'after_hours',
                          label: t('answerModeAfterHours'),
                          description: t('answerModeAfterHoursDescription'),
                          icon: <Voicemail className="h-4 w-4" />,
                        },
                      ]}
                      errors={field.state.meta.errors}
                      className="grid-cols-1 sm:grid-cols-2"
                    />
                  )}
                </form.Field>

                {/* Call recording (opt-in; caller is told at pickup) */}
                <form.AppField name="recordCalls">
                  {(field) => (
                    <field.Switch
                      label={t('recordCalls')}
                      description={t('recordCallsDescription')}
                    />
                  )}
                </form.AppField>

                {/* Personalization */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <form.AppField name="greeting">
                    {(field) => (
                      <field.Input
                        label={`${t('greeting')} (${tCommon('optional')})`}
                        description={t('greetingDescription')}
                        placeholder={t('greetingPlaceholder')}
                        maxLength={AI_PHONE_GREETING_MAX_LENGTH}
                      />
                    )}
                  </form.AppField>

                  <form.AppField name="transferNumber">
                    {(field) => (
                      <field.Input
                        label={`${t('transferNumber')} (${tCommon('optional')})`}
                        description={t('transferNumberDescription')}
                        placeholder="+33123456789"
                      />
                    )}
                  </form.AppField>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <FloatingSaveBar
          isDirty={isDirty}
          isLoading={updateMutation.isPending}
          onReset={() => form.reset()}
        />
      </form.Form>
    </form.AppForm>
  )
}
