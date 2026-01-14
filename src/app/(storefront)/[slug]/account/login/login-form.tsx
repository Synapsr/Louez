'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Mail, KeyRound, ArrowRight, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Card, CardContent } from '@/components/ui/card'
import { useStorefrontUrl } from '@/hooks/use-storefront-url'
import { sendVerificationCode, verifyCode } from '../actions'

interface LoginFormProps {
  storeId: string
  storeSlug: string
}

export function LoginForm({ storeId, storeSlug }: LoginFormProps) {
  const router = useRouter()
  const t = useTranslations('storefront.account')
  const tErrors = useTranslations('errors')
  const { getUrl } = useStorefrontUrl(storeSlug)
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const emailSchema = z.object({
    email: z.string().email(t('codeError')),
  })

  const emailForm = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  })

  const onEmailSubmit = async (data: z.infer<typeof emailSchema>) => {
    setIsLoading(true)
    try {
      const result = await sendVerificationCode(storeId, data.email)

      if (result.error) {
        toast.error(result.error)
        return
      }

      setEmail(data.email)
      setStep('code')
      toast.success(t('codeSent'))
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  const onCodeSubmit = useCallback(async (codeValue: string) => {
    if (codeValue.length !== 6) return

    setIsLoading(true)
    try {
      const result = await verifyCode(storeId, email, codeValue)

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success(t('loginSuccess'))
      router.push(getUrl('/account'))
      router.refresh()
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }, [storeId, email, getUrl, router, t, tErrors])

  const handleCodeChange = useCallback((value: string) => {
    setCode(value)
    // Auto-submit when code is complete
    if (value.length === 6 && !isLoading) {
      onCodeSubmit(value)
    }
  }, [isLoading, onCodeSubmit])

  const handleResendCode = async () => {
    setIsLoading(true)
    try {
      const result = await sendVerificationCode(storeId, email)

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success(t('newCodeSent'))
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  if (step === 'code') {
    return (
      <Card className="border-0 shadow-lg">
        <CardContent className="p-6 sm:p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 mb-3">
              <KeyRound className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-1">{t('enterCode')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('codeDescription')}{' '}
              <span className="font-medium text-foreground">{email}</span>
            </p>
          </div>

          <div className="space-y-6">
            <div className="flex flex-col items-center">
              <InputOTP
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                value={code}
                onChange={handleCodeChange}
                disabled={isLoading}
                autoFocus
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} className="h-12 w-10 sm:h-14 sm:w-12 text-lg" />
                  <InputOTPSlot index={1} className="h-12 w-10 sm:h-14 sm:w-12 text-lg" />
                  <InputOTPSlot index={2} className="h-12 w-10 sm:h-14 sm:w-12 text-lg" />
                  <InputOTPSlot index={3} className="h-12 w-10 sm:h-14 sm:w-12 text-lg" />
                  <InputOTPSlot index={4} className="h-12 w-10 sm:h-14 sm:w-12 text-lg" />
                  <InputOTPSlot index={5} className="h-12 w-10 sm:h-14 sm:w-12 text-lg" />
                </InputOTPGroup>
              </InputOTP>
            </div>

            <Button
              type="button"
              className="w-full h-11"
              disabled={isLoading || code.length !== 6}
              onClick={() => onCodeSubmit(code)}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('verifying')}
                </>
              ) : (
                <>
                  {t('verify')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>

            <div className="flex flex-col items-center gap-3 pt-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t('resendCodeQuestion')}
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="p-0 h-auto gap-1"
                  onClick={handleResendCode}
                  disabled={isLoading}
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('resendCode')}
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep('email')
                  setCode('')
                }}
                disabled={isLoading}
                className="text-muted-foreground"
              >
                {t('changeEmail')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-0 shadow-lg">
      <CardContent className="p-6 sm:p-8">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 mb-3">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold mb-1">{t('yourEmail')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('loginDescription')}
          </p>
        </div>

        <Form {...emailForm}>
          <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-6">
            <FormField
              control={emailForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('emailAddress')}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder={t('emailPlaceholder')}
                      className="h-11"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full h-11" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('sending')}
                </>
              ) : (
                <>
                  {t('sendCode')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
