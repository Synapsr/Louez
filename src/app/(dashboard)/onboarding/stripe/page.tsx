'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FileCheck, Loader2, CheckCircle2, CreditCard, Settings, Info } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'

import { stripeSetupSchema, type StripeSetupInput } from '@/lib/validations/onboarding'
import { completeOnboarding } from '../actions'

export default function OnboardingStripePage() {
  const router = useRouter()
  const t = useTranslations('onboarding.stripe')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<StripeSetupInput>({
    resolver: zodResolver(stripeSetupSchema),
    defaultValues: {
      reservationMode: 'request',
    },
  })

  const reservationMode = useWatch({
    control: form.control,
    name: 'reservationMode',
  })

  async function onSubmit(data: StripeSetupInput) {
    setIsLoading(true)
    try {
      const result = await completeOnboarding(data)
      if (result.error) {
        toast.error(tErrors(result.error.replace('errors.', '')))
        return
      }
      toast.success(t('configComplete'))
      // Signal the welcome animation via sessionStorage (more reliable than URL params)
      sessionStorage.setItem('louez-show-welcome', '1')
      router.push('/dashboard')
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <FileCheck className="text-primary h-6 w-6" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Reservation Mode */}
            <FormField
              control={form.control}
              name="reservationMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('title')}</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="space-y-3"
                    >
                      <div>
                        <RadioGroupItem
                          value="request"
                          id="request"
                          className="peer sr-only"
                        />
                        <Label
                          htmlFor="request"
                          className="border-muted bg-popover hover:bg-accent peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary flex cursor-pointer items-start gap-4 rounded-lg border-2 p-4"
                        >
                          <div className="bg-primary/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                            <CheckCircle2 className="text-primary h-5 w-5" />
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{t('requestMode')}</p>
                              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                {t('recommended')}
                              </span>
                            </div>
                            <p className="text-muted-foreground text-sm">
                              {t('requestModeDescription')}
                            </p>
                          </div>
                        </Label>
                      </div>
                      <div>
                        <RadioGroupItem
                          value="payment"
                          id="payment"
                          className="peer sr-only"
                        />
                        <Label
                          htmlFor="payment"
                          className="border-muted bg-popover hover:bg-accent peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary flex cursor-pointer items-start gap-4 rounded-lg border-2 p-4"
                        >
                          <div className="bg-primary/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                            <CreditCard className="text-primary h-5 w-5" />
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{t('paymentMode')}</p>
                            </div>
                            <p className="text-muted-foreground text-sm">
                              {t('paymentModeDescription')}
                            </p>
                          </div>
                        </Label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Info Box - changes based on selected mode */}
            {reservationMode === 'request' ? (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
                <div className="flex gap-3">
                  <Info className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                      {t('howItWorks')}
                    </p>
                    <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                      <li>{t('step1')}</li>
                      <li>{t('step2')}</li>
                      <li>{t('step3')}</li>
                      <li>{t('step4')}</li>
                      <li>{t('step5')}</li>
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/20">
                <div className="flex gap-3">
                  <Settings className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-violet-800 dark:text-violet-200">
                      {t('paymentSetupTitle')}
                    </p>
                    <p className="text-sm text-violet-700 dark:text-violet-300">
                      {t('paymentSetupDescription')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => router.push('/onboarding/product')}
              >
                {tCommon('back')}
              </Button>
              <Button type="submit" className="flex-1" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {tCommon('confirm')}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
