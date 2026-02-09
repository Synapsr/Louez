'use client';

import { Suspense } from 'react';
import { useEffect, useState } from 'react';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Loader2,
  Mail,
  Package,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { authClient } from '@louez/auth/client';
import { Button } from '@louez/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';
import { Input } from '@louez/ui';
import { Label } from '@louez/ui';
import { Separator } from '@louez/ui';
import { Alert, AlertDescription } from '@louez/ui';
import { Logo } from '@louez/ui';

import { env } from '@/env';

const features = [
  { icon: Package, labelKey: 'featureProducts' },
  { icon: Calendar, labelKey: 'featureReservations' },
  { icon: Users, labelKey: 'featureCustomers' },
  { icon: BarChart3, labelKey: 'featureStats' },
];

/**
 * Validates redirect URLs to prevent open redirect attacks
 * Only allows relative paths or URLs pointing to the same domain/subdomains
 */
function isValidRedirectUrl(url: string | null): string {
  const defaultUrl = '/dashboard';

  if (!url) return defaultUrl;

  // Allow relative paths that start with / but not //
  // The regex ensures: starts with /, followed by alphanumeric, hyphen, underscore, or /
  // This prevents protocol-relative URLs like //evil.com
  if (/^\/(?!\/)[a-zA-Z0-9\-_/?&=#%]*$/.test(url)) {
    return url;
  }

  // For absolute URLs, validate they point to our domain
  try {
    const parsed = new URL(url);
    const appUrl = env.NEXT_PUBLIC_APP_URL;
    const appDomain = new URL(appUrl).hostname;

    // Check if the redirect URL is for our domain (or subdomains)
    if (
      parsed.hostname === appDomain ||
      parsed.hostname.endsWith(`.${appDomain}`)
    ) {
      return url;
    }
  } catch {
    // Invalid URL format - fall through to default
  }

  // Reject any other URLs (external domains, invalid formats)
  return defaultUrl;
}

function LoginForm() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const callbackUrl = isValidRedirectUrl(searchParams.get('callbackUrl'));
  const error = searchParams.get('error');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [loginMethod, setLoginMethod] = useState<'magic-link' | 'otp'>(
    'magic-link',
  );
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');

  // Persist referral code in a cookie so it survives OAuth/magic-link redirects
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref && /^LOUEZ[A-HJ-NP-Z2-9]{7}$/.test(ref)) {
      document.cookie = `louez_referral=${ref}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`;
    }
  }, [searchParams]);

  // Map OAuth errors to user-friendly messages
  const getErrorMessage = (errorCode: string | null) => {
    if (!errorCode) return null;
    switch (errorCode) {
      case 'OAuthAccountNotLinked':
        return t('errors.accountNotLinked');
      case 'OAuthSignin':
      case 'OAuthCallback':
        return t('errors.oauthError');
      case 'AccessDenied':
        return t('errors.accessDenied');
      case 'Verification':
        return t('errors.verification');
      default:
        return t('errors.default');
    }
  };

  const errorMessage = getErrorMessage(error);

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    if (loginMethod === 'magic-link') {
      await authClient.signIn.magicLink({
        email,
        callbackURL: callbackUrl,
      });
      setEmailSent(true);
    } else {
      // OTP flow - send the code
      await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'sign-in',
      });
      setOtpSent(true);
    }

    setIsLoading(false);
  }

  async function handleOtpVerify(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    const { error } = await authClient.signIn.emailOtp({
      email,
      otp,
    });

    if (error) {
      setIsLoading(false);
      // Could show error toast here
      return;
    }

    window.location.href = callbackUrl;
  }

  async function handleGoogleSignIn() {
    setIsLoading(true);
    await authClient.signIn.social({
      provider: 'google',
      callbackURL: callbackUrl,
    });
  }

  return (
    <div className="w-full max-w-md space-y-8">
      {/* Mobile Logo */}
      <div className="mb-8 text-center lg:hidden">
        <Link href="/">
          <Logo className="mx-auto h-7 w-auto" />
        </Link>
      </div>

      {otpSent ? (
        <Card className="border-0 shadow-none lg:border lg:shadow">
          <CardHeader className="space-y-4 text-center">
            <div className="bg-primary/10 mx-auto flex h-16 w-16 items-center justify-center rounded-full">
              <Mail className="text-primary h-8 w-8" />
            </div>
            <CardTitle className="text-2xl">{t('enterCode')}</CardTitle>
            <CardDescription className="text-base">
              {t('codeSentTo')} <strong>{email}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleOtpVerify} className="space-y-4">
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
                autoFocus
                disabled={isLoading}
              />
              <Button
                type="submit"
                className="h-12 w-full text-base font-medium"
                disabled={isLoading || otp.length !== 6}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('verifying')}
                  </>
                ) : (
                  t('verify')
                )}
              </Button>
            </form>
            <Button
              variant="outline"
              onClick={() => {
                setOtpSent(false);
                setOtp('');
              }}
              className="mt-3 w-full"
            >
              {t('tryDifferentEmail')}
            </Button>
          </CardContent>
        </Card>
      ) : emailSent ? (
        <Card className="border-0 shadow-none lg:border lg:shadow">
          <CardHeader className="space-y-4 text-center">
            <div className="bg-primary/10 mx-auto flex h-16 w-16 items-center justify-center rounded-full">
              <Mail className="text-primary h-8 w-8" />
            </div>
            <CardTitle className="text-2xl">{t('checkEmail')}</CardTitle>
            <CardDescription className="text-base">
              {t('emailSentTo')} <strong>{email}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-muted-foreground text-sm">
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
        <Card className="border-0 shadow-none lg:border lg:shadow">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-2xl font-bold">
              {t('loginTitle')}
            </CardTitle>
            <CardDescription className="text-base">
              {t('loginDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {errorMessage && (
              <Alert variant="error">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}

            <Button
              variant="outline"
              className="h-12 w-full text-base font-medium"
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
                <span className="bg-card text-muted-foreground px-3">
                  {t('or')}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant={loginMethod === 'magic-link' ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                type="button"
                onClick={() => setLoginMethod('magic-link')}
              >
                {t('magicLink')}
              </Button>
              <Button
                variant={loginMethod === 'otp' ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                type="button"
                onClick={() => setLoginMethod('otp')}
              >
                {t('code')}
              </Button>
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
                className="group h-12 w-full text-base font-medium"
                disabled={isLoading || !email}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('sending')}
                  </>
                ) : (
                  <>
                    {loginMethod === 'otp'
                      ? t('sendCode') || t('continueWithEmail')
                      : t('continueWithEmail')}
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </Button>
            </form>

            <div className="bg-muted/50 flex items-start gap-3 rounded-lg p-4">
              <CheckCircle2 className="text-primary mt-0.5 h-5 w-5 shrink-0" />
              <p className="text-muted-foreground text-sm">
                {t('linkWillBeSent')}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-center text-sm">
        {t('termsAgreement')}{' '}
        <Link
          href="/terms"
          className="hover:text-primary underline underline-offset-4"
        >
          {t('termsOfService')}
        </Link>{' '}
        {t('and')}{' '}
        <Link
          href="/privacy"
          className="hover:text-primary underline underline-offset-4"
        >
          {t('privacyPolicy')}
        </Link>
      </p>
    </div>
  );
}

function LoginFormFallback() {
  return (
    <div className="w-full max-w-md space-y-8">
      <Card className="border-0 shadow-none lg:border lg:shadow">
        <CardHeader className="space-y-2 text-center">
          <div className="bg-muted mx-auto h-8 w-32 animate-pulse rounded" />
          <div className="bg-muted mx-auto h-4 w-48 animate-pulse rounded" />
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted h-12 animate-pulse rounded" />
          <div className="bg-muted h-12 animate-pulse rounded" />
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  const t = useTranslations('auth');

  return (
    <div className="flex min-h-screen">
      {/* Left Side - Branding */}
      <div className="from-primary via-primary/90 to-primary/80 text-primary-foreground relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br p-12 lg:flex lg:w-1/2">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/20 blur-3xl" />
          <div className="absolute right-0 bottom-0 h-96 w-96 translate-x-1/2 translate-y-1/2 rounded-full bg-white/20 blur-3xl" />
        </div>

        <div className="relative z-10">
          <Link href="/">
            <Logo className="h-7 w-auto text-white" />
          </Link>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h1 className="mb-4 text-4xl leading-tight font-bold">
              {t('heroTitle')}
            </h1>
            <p className="text-primary-foreground/80 max-w-md text-lg">
              {t('heroSubtitle')}
            </p>
          </div>

          <div className="space-y-4">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.labelKey} className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-primary-foreground/90">
                    {t(feature.labelKey)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-primary-foreground/60 text-sm">{t('trustedBy')}</p>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="bg-background flex flex-1 items-center justify-center p-6 lg:p-12">
        <Suspense fallback={<LoginFormFallback />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
