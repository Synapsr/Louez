'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { revalidateLogic, useStore } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import {
  ArrowRight,
  Lock,
  Phone,
  PhoneCall,
  TriangleAlert,
  Voicemail,
  Zap,
} from 'lucide-react'

import {
  Alert,
  AlertDescription,
  AlertTitle,
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
}

export const VoiceAgentForm = ({
  store,
  hasFeatureAccess,
  phoneConfigured,
  boundNumber,
  isProvisioned,
  webhookUrl,
  defaultCountry,
}: VoiceAgentFormProps) => {
  const router = useRouter()
  const t = useTranslations('dashboard.settings.aiVoiceAgent')
  const tAdvisor = useTranslations('dashboard.settings.aiAdvisor')
  const tValidation = useTranslations('validation')
  const tCommon = useTranslations('common')

  const schema = createAiPhoneSettingsSchema(t, tValidation)
  const current = store.aiPhoneSettings || defaultAiPhoneSettings

  const [rootError, setRootError] = useState<string | null>(null)
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
      toastManager.add({ title: t('saved'), type: 'success' })
      form.options.defaultValues = value
      form.reset()
      router.refresh()
    },
  })

  const isDirty = useStore(form.store, (s) => s.isDirty)
  const isEnabled = useStore(form.store, (s) => s.values.enabled)

  // The voice preview is spoken in the currently selected language.
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
            <form.AppField name="enabled">
              {(field) => (
                <field.Switch
                  label={t('enabled')}
                  description={t('enabledDescription')}
                />
              )}
            </form.AppField>

            {isEnabled && (
              <div className="space-y-6 border-t pt-6">
                {/* Inbound number: provision, link or release — part of the agent */}
                <VoiceNumberProvisioning
                  boundNumber={boundNumber}
                  isProvisioned={isProvisioned}
                  webhookUrl={webhookUrl}
                  defaultCountry={defaultCountry}
                  disabled={!phoneConfigured}
                />

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
