'use client'

import { useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
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
import { toast } from 'sonner'

import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'
import { updateInspectionSettings } from './actions'
import type { StoreSettings, InspectionSettings } from '@/types'

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

  const form = useForm<InspectionSettingsInput>({
    resolver: zodResolver(inspectionSettingsSchema),
    defaultValues: {
      enabled: currentInspection.enabled,
      mode: currentInspection.mode || 'optional',
      requireCustomerSignature: currentInspection.requireCustomerSignature,
      autoGeneratePdf: currentInspection.autoGeneratePdf,
      maxPhotosPerItem: currentInspection.maxPhotosPerItem,
    },
  })

  const { isDirty } = form.formState

  const handleReset = useCallback(() => {
    form.reset()
  }, [form])

  const isEnabled = form.watch('enabled')
  const mode = form.watch('mode')

  async function onSubmit(data: InspectionSettingsInput) {
    startTransition(async () => {
      const result = await updateInspectionSettings(data)

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success(t('saved'))
      form.reset(data)
      router.refresh()
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">{t('enabled')}</FormLabel>
                    <FormDescription>{t('enabledDescription')}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
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
              <FormField
                control={form.control}
                name="mode"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <RadioGroup
                        value={field.value}
                        onValueChange={field.onChange}
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
                    </FormControl>
                  </FormItem>
                )}
              />
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
              <FormField
                control={form.control}
                name="requireCustomerSignature"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="flex items-center gap-3">
                      <PenLine className="h-5 w-5 text-muted-foreground" />
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          {t('requireCustomerSignature')}
                        </FormLabel>
                        <FormDescription>
                          {t('requireCustomerSignatureDescription')}
                        </FormDescription>
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="autoGeneratePdf"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          {t('autoGeneratePdf')}
                        </FormLabel>
                        <FormDescription>
                          {t('autoGeneratePdfDescription')}
                        </FormDescription>
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
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
              <FormField
                control={form.control}
                name="maxPhotosPerItem"
                render={({ field }) => (
                  <FormItem>
                    <FormDescription className="mb-4">
                      {t('maxPhotosPerItemDescription')}
                    </FormDescription>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        className="w-32"
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value, 10) || 1)
                        }
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        )}

        <FloatingSaveBar
          isDirty={isDirty}
          isLoading={isPending}
          onReset={handleReset}
        />
      </form>
    </Form>
  )
}
