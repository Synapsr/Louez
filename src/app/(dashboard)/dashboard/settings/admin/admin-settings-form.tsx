'use client'

import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTransition, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { Shield } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
  FormMessage,
} from '@/components/ui/form'
import { updateTrialDays } from './actions'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'

const trialDaysSchema = z.object({
  trialDays: z.number().int().min(0).max(365),
})

type TrialDaysInput = z.infer<typeof trialDaysSchema>

interface AdminSettingsFormProps {
  trialDays: number
}

export function AdminSettingsForm({ trialDays }: AdminSettingsFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const t = useTranslations('dashboard.settings.admin')
  const tCommon = useTranslations('common')

  const form = useForm<TrialDaysInput>({
    resolver: zodResolver(trialDaysSchema),
    defaultValues: { trialDays },
  })

  const { isDirty } = form.formState

  const handleReset = useCallback(() => {
    form.reset()
  }, [form])

  const onSubmit = (data: TrialDaysInput) => {
    startTransition(async () => {
      const result = await updateTrialDays(data)
      if (result.error) {
        form.setError('root', { message: result.error })
        return
      }
      toast.success(t('saved'))
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
            <CardDescription>
              {t('trialSectionDescription')}
            </CardDescription>
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
                      <span className="text-sm text-muted-foreground">
                        {t('days')}
                      </span>
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t('trialDaysDescription')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <FloatingSaveBar
          isDirty={isDirty}
          isLoading={isPending}
          onReset={handleReset}
        />
      </form>
    </Form>
  )
}
