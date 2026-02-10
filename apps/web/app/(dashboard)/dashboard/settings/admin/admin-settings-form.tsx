'use client'

import { useRouter } from 'next/navigation'
import { useTransition, useState } from 'react'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { Shield, Percent } from 'lucide-react'
import { toastManager, Label } from '@louez/ui'
import { useStore } from '@tanstack/react-form'

import { Input } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { updateAdminSettings } from './actions'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'
import { useAppForm } from '@/hooks/form/form'
import { RootError } from '@/components/form/root-error'

const adminSettingsSchema = z.object({
  trialDays: z.number().int().min(0).max(365),
  discountPercent: z.number().int().min(0).max(100),
  discountDurationMonths: z.number().int().min(0).max(120),
})

type AdminSettingsInput = z.infer<typeof adminSettingsSchema>

interface AdminSettingsFormProps {
  trialDays: number
  discountPercent: number
  discountDurationMonths: number
}

export function AdminSettingsForm({
  trialDays,
  discountPercent,
  discountDurationMonths,
}: AdminSettingsFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const t = useTranslations('dashboard.settings.admin')
  const [rootError, setRootError] = useState<string | null>(null)

  const form = useAppForm({
    defaultValues: {
      trialDays,
      discountPercent,
      discountDurationMonths,
    },
    validators: { onSubmit: adminSettingsSchema },
    onSubmit: async ({ value }) => {
      setRootError(null)
      startTransition(async () => {
        const result = await updateAdminSettings(value)
        if (result.error) {
          setRootError(result.error)
          return
        }
        toastManager.add({ title: t('saved'), type: 'success' })
        form.reset()
        router.refresh()
      })
    },
  })

  const isDirty = useStore(form.store, (s) => s.isDirty)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="space-y-6"
    >
      <RootError error={rootError} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t('trialSection')}
          </CardTitle>
          <CardDescription>{t('trialSectionDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form.Field name="trialDays">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor={field.name}>{t('trialDays')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={field.name}
                    type="number"
                    min={0}
                    max={365}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(parseInt(e.target.value) || 0)}
                    onBlur={field.handleBlur}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">{t('days')}</span>
                </div>
                <p className="text-muted-foreground text-sm">{t('trialDaysDescription')}</p>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                )}
              </div>
            )}
          </form.Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            {t('discountSection')}
          </CardTitle>
          <CardDescription>{t('discountSectionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form.Field name="discountPercent">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor={field.name}>{t('discountPercent')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={field.name}
                    type="number"
                    min={0}
                    max={100}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(parseInt(e.target.value) || 0)}
                    onBlur={field.handleBlur}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <p className="text-muted-foreground text-sm">{t('discountPercentDescription')}</p>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field name="discountDurationMonths">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor={field.name}>{t('discountDuration')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={field.name}
                    type="number"
                    min={0}
                    max={120}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(parseInt(e.target.value) || 0)}
                    onBlur={field.handleBlur}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">{t('months')}</span>
                </div>
                <p className="text-muted-foreground text-sm">{t('discountDurationDescription')}</p>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>
                )}
              </div>
            )}
          </form.Field>
        </CardContent>
      </Card>

      <FloatingSaveBar isDirty={isDirty} isLoading={isPending} onReset={() => form.reset()} />
    </form>
  )
}
