'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { loadStripe } from '@stripe/stripe-js'
import { env } from '@/env'
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import { useTranslations } from 'next-intl'
import { Button } from '@louez/ui'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui'
import { Alert, AlertDescription } from '@louez/ui'
import { Loader2, Shield, Info } from 'lucide-react'
import { formatCurrency } from '@louez/utils'
import {
  createDepositPaymentIntent,
  confirmDepositAuthorization,
} from './actions'

interface DepositFormProps {
  store: {
    id: string
    name: string
    slug: string
    stripeAccountId: string
    theme?: { primaryColor?: string } | null
  }
  reservation: {
    id: string
    number: string
    depositAmount: number
  }
  customer: {
    firstName: string
    email: string
  }
  currency: string
  locale: string
}

function CheckoutForm({
  store,
  reservation,
  currency,
  onSuccess,
  t,
}: Omit<DepositFormProps, 'customer'> & {
  onSuccess: (redirectUrl?: string) => void
  t: ReturnType<typeof useTranslations<'storefront.authorizeDeposit'>>
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!stripe || !elements) {
      return
    }

    setIsProcessing(true)
    setErrorMessage(null)

    try {
      // Confirm the payment (this creates the authorization hold)
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/${store.slug}/authorize-deposit/${reservation.id}/success`,
        },
        redirect: 'if_required',
      })

      if (error) {
        setErrorMessage(error.message || t('errors.generic'))
        setIsProcessing(false)
        return
      }

      if (paymentIntent && paymentIntent.status === 'requires_capture') {
        // Authorization successful - update the database
        const result = await confirmDepositAuthorization({
          reservationId: reservation.id,
          storeId: store.id,
          paymentIntentId: paymentIntent.id,
          paymentMethodId: paymentIntent.payment_method as string,
        })

        if (result.error) {
          setErrorMessage(t('confirmationError'))
          setIsProcessing(false)
          return
        }

        onSuccess(result.redirectUrl)
      } else {
        setErrorMessage(t('unexpectedStatus'))
        setIsProcessing(false)
      }
    } catch (err) {
      console.error('Payment error:', err)
      setErrorMessage(t('unexpectedError'))
      setIsProcessing(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Info box */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          {t('infoBox')}
        </AlertDescription>
      </Alert>

      {/* Payment Element */}
      <div className="border rounded-lg p-4 bg-background">
        <PaymentElement
          options={{
            layout: 'tabs',
          }}
        />
      </div>

      {/* Error message */}
      {errorMessage && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {/* Submit button */}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={!stripe || isProcessing}
        style={{
          backgroundColor: store.theme?.primaryColor || undefined,
        }}
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('processing')}
          </>
        ) : (
          <>
            <Shield className="mr-2 h-4 w-4" />
            {t('authorizeButton', { amount: formatCurrency(reservation.depositAmount, currency) })}
          </>
        )}
      </Button>

      {/* Security note */}
      <p className="text-xs text-center text-muted-foreground">
        {t('securePayment')}
      </p>
    </form>
  )
}

export function DepositForm(props: DepositFormProps) {
  const router = useRouter()
  const t = useTranslations('storefront.authorizeDeposit')
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSuccess, setIsSuccess] = useState(false)

  useEffect(() => {
    // Load Stripe with the connected account
    const stripe = loadStripe(
      env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      {
        stripeAccount: props.store.stripeAccountId,
      }
    )
    setStripePromise(stripe)

    // Create PaymentIntent
    createDepositPaymentIntent({
      reservationId: props.reservation.id,
      storeId: props.store.id,
    }).then((result) => {
      if (result.error) {
        setError(result.error)
      } else if (result.clientSecret) {
        setClientSecret(result.clientSecret)
      }
      setIsLoading(false)
    })
  }, [props.store.stripeAccountId, props.store.id, props.reservation.id])

  const handleSuccess = (redirectUrl?: string) => {
    setIsSuccess(true)
    // Redirect to account with auto-login after a short delay
    setTimeout(() => {
      if (redirectUrl) {
        router.push(redirectUrl)
      } else {
        // Fallback to success page if no redirect URL (shouldn't happen normally)
        router.push(`/${props.store.slug}/authorize-deposit/${props.reservation.id}/success`)
      }
    }, 1500)
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <Alert variant="destructive">
            <AlertDescription>
              {error === 'deposit_already_authorized'
                ? t('errors.alreadyAuthorized')
                : error === 'no_deposit_required'
                  ? t('errors.noDepositRequired')
                  : t('errors.generic')}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  if (isSuccess) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
            <Shield className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <h3 className="text-xl font-semibold mb-2">{t('success.title')}</h3>
          <p className="text-muted-foreground">{t('redirecting')}</p>
        </CardContent>
      </Card>
    )
  }

  if (!clientSecret || !stripePromise) {
    return (
      <Card>
        <CardContent className="py-8">
          <Alert variant="destructive">
            <AlertDescription>
              {t('paymentInitError')}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          {t('title')}
        </CardTitle>
        <CardDescription>
          {t('subtitle', { number: props.reservation.number })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Amount display */}
        <div className="mb-6 p-4 rounded-lg bg-muted/50 text-center">
          <p className="text-sm text-muted-foreground mb-1">{t('depositAmount')}</p>
          <p className="text-3xl font-bold">
            {formatCurrency(props.reservation.depositAmount, props.currency)}
          </p>
        </div>

        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: {
              theme: 'stripe',
              variables: {
                colorPrimary: props.store.theme?.primaryColor || '#0066FF',
              },
            },
            locale: props.locale as 'fr' | 'en' | 'de' | 'es' | 'it' | 'nl' | 'pl' | 'pt',
          }}
        >
          <CheckoutForm
            store={props.store}
            reservation={props.reservation}
            currency={props.currency}
            locale={props.locale}
            onSuccess={handleSuccess}
            t={t}
          />
        </Elements>
      </CardContent>
    </Card>
  )
}
