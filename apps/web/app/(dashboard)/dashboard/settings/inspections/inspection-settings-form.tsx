'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import {
  ClipboardCheck,
  Camera,
  PenLine,
  FileText,
  Settings2,
  FileCheck2,
} from 'lucide-react'
import { toastManager } from '@louez/ui'
import { useStore } from '@tanstack/react-form'

import { Switch } from '@louez/ui'
import { Input } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { RadioGroup, RadioGroupItem } from '@louez/ui'
import { Label } from '@louez/ui'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'
import { updateInspectionSettings } from './actions'
import type { StoreSettings, InspectionSettings } from '@louez/types'
import { useAppForm } from '@/hooks/form/form'
import { RootError } from '@/components/form/root-error'

const INSPECTION_MODES = ['optional', 'recommended', 'required'] as const

const createInspectionSettingsSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string
) =>
  z.object({
    enabled: z.boolean(),
    mode: z.enum(INSPECTION_MODES),
    requireCustomerSignature: z.boolean(),
    autoGeneratePdf: z.boolean(),
    maxPhotosPerItem: z
      .number()
      .min(1, t('minValue', { min: 1 }))
      .max(50, t('maxValue', { max: 50 })),
  })

type InspectionSettingsInput = z.infer<
  ReturnType<typeof createInspectionSettingsSchema>
>

interface Store {
  id: string
  settings: StoreSettings | null
}

interface InspectionSettingsFormProps {
  store: Store
}

export function InspectionSettingsForm({ store }: InspectionSettingsFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const t = useTranslations('dashboard.settings.inspection')
  const tValidation = useTranslations('validation')

  const inspectionSettingsSchema = createInspectionSettingsSchema(tValidation)

  const currentInspection: InspectionSettings = store.settings?.inspection || {
    enabled: false,
    mode: 'optional',
    requireCustomerSignature: true,
    autoGeneratePdf: true,
    maxPhotosPerItem: 10,
  }

  const [rootError, setRootError] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: {
      enabled: currentInspection.enabled,
      mode: currentInspection.mode || 'optional',
      requireCustomerSignature: currentInspection.requireCustomerSignature,
      autoGeneratePdf: currentInspection.autoGeneratePdf,
      maxPhotosPerItem: currentInspection.maxPhotosPerItem,
    },
    validators: { onSubmit: inspectionSettingsSchema },
    onSubmit: async ({ value }) => {
      setRootError(null)
      startTransition(async () => {
        const result = await updateInspectionSettings(value)
        if (result.error) {
          setRootError(result.error)
          return
        }
        toastManager.add({ title: t('saved'), type: 'success' })
        router.refresh()
      })
    },
  })

  const isDirty = useStore(form.store, (s) => s.isDirty)
  const isEnabled = useStore(form.store, (s) => s.values.enabled)
  const mode = useStore(form.store, (s) => s.values.mode)

  return (
    <form.AppForm>
      <form.Form className="space-y-6">
        <RootError error={rootError} />

      {/* Enable Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            {t('enableSection')}
          </CardTitle>
          <CardDescription>{t('enableSectionDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form.AppField name="enabled">
            {(field) => (
              <field.Switch
                label={t('enabled')}
                description={t('enabledDescription')}
              />
            )}
          </form.AppField>
        </CardContent>
      </Card>

      {/* Mode Section */}
      {isEnabled && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />
              {t('modeSection')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form.Field name="mode">
              {(field) => (
                <div className="grid gap-2">
                  <RadioGroup
                    value={field.state.value}
                    onValueChange={(val) => field.handleChange(val)}
                    className="space-y-3"
                  >
                    <label
                      htmlFor="optional"
                      className="flex cursor-pointer items-start space-x-3 rounded-lg border p-4 transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                    >
                      <RadioGroupItem
                        value="optional"
                        id="optional"
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <span className="text-base font-medium">
                          {t('modeOptional')}
                        </span>
                        <p className="text-sm text-muted-foreground">
                          {t('modeOptionalDescription')}
                        </p>
                      </div>
                    </label>

                    <label
                      htmlFor="recommended"
                      className="flex cursor-pointer items-start space-x-3 rounded-lg border p-4 transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                    >
                      <RadioGroupItem
                        value="recommended"
                        id="recommended"
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <span className="text-base font-medium">
                          {t('modeRecommended')}
                        </span>
                        <p className="text-sm text-muted-foreground">
                          {t('modeRecommendedDescription')}
                        </p>
                      </div>
                    </label>

                    <label
                      htmlFor="required"
                      className="flex cursor-pointer items-start space-x-3 rounded-lg border p-4 transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                    >
                      <RadioGroupItem
                        value="required"
                        id="required"
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <span className="text-base font-medium">
                          {t('modeRequired')}
                        </span>
                        <p className="text-sm text-muted-foreground">
                          {t('modeRequiredDescription')}
                        </p>
                      </div>
                    </label>
                  </RadioGroup>
                  {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>}
                </div>
              )}
            </form.Field>
          </CardContent>
        </Card>
      )}

      {/* Signature & PDF Section */}
      {isEnabled && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-primary" />
              {t('signatureSection')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form.Field name="requireCustomerSignature">
              {(field) => (
                <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <PenLine className="h-5 w-5 text-muted-foreground" />
                    <div className="space-y-0.5">
                      <Label htmlFor={field.name} className="text-base">
                        {t('requireCustomerSignature')}
                      </Label>
                      <p className="text-muted-foreground text-sm">
                        {t('requireCustomerSignatureDescription')}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(checked)}
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="autoGeneratePdf">
              {(field) => (
                <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div className="space-y-0.5">
                      <Label htmlFor={field.name} className="text-base">
                        {t('autoGeneratePdf')}
                      </Label>
                      <p className="text-muted-foreground text-sm">
                        {t('autoGeneratePdfDescription')}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(checked)}
                  />
                </div>
              )}
            </form.Field>
          </CardContent>
        </Card>
      )}

      {/* Photos Section */}
      {isEnabled && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              {t('maxPhotosPerItem')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form.Field name="maxPhotosPerItem">
              {(field) => (
                <div className="grid gap-2">
                  <p className="text-muted-foreground text-sm mb-4">
                    {t('maxPhotosPerItemDescription')}
                  </p>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    className="w-32"
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) =>
                      field.handleChange(parseInt(e.target.value, 10) || 1)
                    }
                  />
                  {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>}
                </div>
              )}
            </form.Field>
          </CardContent>
        </Card>
      )}

        <FloatingSaveBar
          isDirty={isDirty}
          isLoading={isPending}
          onReset={() => form.reset()}
        />
      </form.Form>
    </form.AppForm>
  )
}
