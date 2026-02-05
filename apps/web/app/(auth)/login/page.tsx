'use client'

import { Suspense } from 'react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { env } from '@/env'
import { Button } from '@louez/ui'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui'
import { Input } from '@louez/ui'
import { Label } from '@louez/ui'
import { Separator } from '@louez/ui'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Package, Calendar, Users, BarChart3, ArrowRight, Loader2, Mail, CheckCircle2, AlertCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@louez/ui'
import { Logo } from '@/components/ui/logo'

const features = [
  { icon: Package, labelKey: 'featureProducts' },
  { icon: Calendar, labelKey: 'featureReservations' },
  { icon: Users, labelKey: 'featureCustomers' },
  { icon: BarChart3, labelKey: 'featureStats' },
]

/**
 * Validates redirect URLs to prevent open redirect attacks
 * Only allows relative paths or URLs pointing to the same domain/subdomains
 */
function isValidRedirectUrl(url: string | null): string {
  const defaultUrl = '/dashboard'

  if (!url) return defaultUrl

  // Allow relative paths that start with / but not //
  // The regex ensures: starts with /, followed by alphanumeric, hyphen, underscore, or /
  // This prevents protocol-relative URLs like //evil.com
  if (/^\/(?!\/)[a-zA-Z0-9\-_/?&=#%]*$/.test(url)) {
    return url
  }

  // For absolute URLs, validate they point to our domain
  try {
    const parsed = new URL(url)
    const appUrl = env.NEXT_PUBLIC_APP_URL
    const appDomain = new URL(appUrl).hostname

    // Check if the redirect URL is for our domain (or subdomains)
    if (parsed.hostname === appDomain || parsed.hostname.endsWith(`.${appDomain}`)) {
      return url
    }
  } catch {
    // Invalid URL format - fall through to default
  }

  // Reject any other URLs (external domains, invalid formats)
  return defaultUrl
}

function LoginForm() {
  const t = useTranslations('auth')
  const searchParams = useSearchParams()
  const callbackUrl = isValidRedirectUrl(searchParams.get('callbackUrl'))
  const error = searchParams.get('error')
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  // Persist referral code in a cookie so it survives OAuth/magic-link redirects
  useEffect(() => {
    const ref = searchParams.get('ref')
    if (ref && /^LOUEZ[A-HJ-NP-Z2-9]{7}$/.test(ref)) {
      document.cookie = `louez_referral=${ref}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`
    }
  }, [searchParams])

  // Map OAuth errors to user-friendly messages
  const getErrorMessage = (errorCode: string | null) => {
    if (!errorCode) return null
    switch (errorCode) {
      case 'OAuthAccountNotLinked':
        return t('errors.accountNotLinked')
      case 'OAuthSignin':
      case 'OAuthCallback':
        return t('errors.oauthError')
      case 'AccessDenied':
        return t('errors.accessDenied')
      case 'Verification':
        return t('errors.verification')
      default:
        return t('errors.default')
    }
  }

  const errorMessage = getErrorMessage(error)

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    await signIn('nodemailer', { email, callbackUrl, redirect: false })
    setEmailSent(true)
    setIsLoading(false)
  }

  async function handleGoogleSignIn() {
    setIsLoading(true)
    await signIn('google', { callbackUrl })
  }

  return (
    <div className="w-full max-w-md space-y-8">
      {/* Mobile Logo */}
      <div className="lg:hidden text-center mb-8">
        <Link href="/">
          <Logo className="h-7 w-auto mx-auto" />
        </Link>
      </div>

      {emailSent ? (
        <Card className="border-0 shadow-none lg:shadow lg:border">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">{t('checkEmail')}</CardTitle>
            <CardDescription className="text-base">
              {t('emailSentTo')} <strong>{email}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              {t('clickLinkToSignIn')}
            </p>
            <Button
              variant="outline"
              onClick={() => setEmailSent(false)}
              className="mt-4"
            >
              {t('tryDifferentEmail')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-none lg:shadow lg:border">
          <CardHeader className="text-center space-y-2">
            <CardTitle className="text-2xl font-bold">{t('loginTitle')}</CardTitle>
            <CardDescription className="text-base">
              {t('loginDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {errorMessage && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}

            <Button
              variant="outline"
              className="w-full h-12 text-base font-medium"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
            >
              <svg className="mr-3 h-5 w-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {t('continueWithGoogle')}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-3 text-muted-foreground">{t('or')}</span>
              </div>
            </div>

            <form onSubmit={handleEmailSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  {t('email')}
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t('emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12"
                  disabled={isLoading}
                />
              </div>
              <Button
                type="submit"
                className="w-full h-12 text-base font-medium group"
                disabled={isLoading || !email}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('sending')}
                  </>
                ) : (
                  <>
                    {t('continueWithEmail')}
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </Button>
            </form>

            <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                {t('linkWillBeSent')}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {t('termsAgreement')}{' '}
        <Link href="/terms" className="underline underline-offset-4 hover:text-primary">
          {t('termsOfService')}
        </Link>{' '}
        {t('and')}{' '}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-primary">
          {t('privacyPolicy')}
        </Link>
      </p>
    </div>
  )
}

function LoginFormFallback() {
  return (
    <div className="w-full max-w-md space-y-8">
      <Card className="border-0 shadow-none lg:shadow lg:border">
        <CardHeader className="text-center space-y-2">
          <div className="h-8 bg-muted rounded animate-pulse mx-auto w-32" />
          <div className="h-4 bg-muted rounded animate-pulse mx-auto w-48" />
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="h-12 bg-muted rounded animate-pulse" />
          <div className="h-12 bg-muted rounded animate-pulse" />
        </CardContent>
      </Card>
    </div>
  )
}

export default function LoginPage() {
  const t = useTranslations('auth')

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary via-primary/90 to-primary/80 text-primary-foreground p-12 flex-col justify-between relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-96 h-96 bg-white/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-white/20 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
        </div>

        <div className="relative z-10">
          <Link href="/">
            <Logo className="h-7 w-auto text-white" />
          </Link>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h1 className="text-4xl font-bold leading-tight mb-4">
              {t('heroTitle')}
            </h1>
            <p className="text-lg text-primary-foreground/80 max-w-md">
              {t('heroSubtitle')}
            </p>
          </div>

          <div className="space-y-4">
            {features.map((feature) => {
              const Icon = feature.icon
              return (
                <div key={feature.labelKey} className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-primary-foreground/90">{t(feature.labelKey)}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-sm text-primary-foreground/60">
            {t('trustedBy')}
          </p>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-background">
        <Suspense fallback={<LoginFormFallback />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
