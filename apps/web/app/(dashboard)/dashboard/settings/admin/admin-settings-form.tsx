'use client'

import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTransition, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { Shield, Percent } from 'lucide-react'
import { toastManager } from '@louez/ui'

import { Input } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@louez/ui'
import { updateAdminSettings } from './actions'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'

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

  const form = useForm<AdminSettingsInput>({
    resolver: zodResolver(adminSettingsSchema),
    defaultValues: {
      trialDays,
      discountPercent,
      discountDurationMonths,
    },
  })

  const { isDirty } = form.formState

  const handleReset = useCallback(() => {
    form.reset()
  }, [form])

  const onSubmit = (data: AdminSettingsInput) => {
    startTransition(async () => {
      const result = await updateAdminSettings(data)
      if (result.error) {
        form.setError('root', { message: result.error })
        return
      }
      toastManager.add({ title: t('saved'), type: 'success' })
      form.reset(data)
      router.refresh()
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {form.formState.errors.root && (
          <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
            {form.formState.errors.root.message}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              {t('trialSection')}
            </CardTitle>
            <CardDescription>{t('trialSectionDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="trialDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('trialDays')}</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">{t('days')}</span>
                    </div>
                  </FormControl>
                  <FormDescription>{t('trialDaysDescription')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
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
            <FormField
              control={form.control}
              name="discountPercent"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('discountPercent')}</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                  </FormControl>
                  <FormDescription>{t('discountPercentDescription')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="discountDurationMonths"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('discountDuration')}</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={120}
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">{t('months')}</span>
                    </div>
                  </FormControl>
                  <FormDescription>{t('discountDurationDescription')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <FloatingSaveBar isDirty={isDirty} isLoading={isPending} onReset={handleReset} />
      </form>
    </Form>
  )
}
