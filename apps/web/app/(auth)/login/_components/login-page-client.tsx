'use client';

import Link from 'next/link';

import { BarChart3, Calendar, Package, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Logo } from '@louez/ui';

import { LoginForm } from './login-form';

export interface LoginPageClientProps {
  callbackUrl: string;
  errorCode: string | null;
  refCode: string | null;
}

const features = [
  { icon: Package, labelKey: 'featureProducts' },
  { icon: Calendar, labelKey: 'featureReservations' },
  { icon: Users, labelKey: 'featureCustomers' },
  { icon: BarChart3, labelKey: 'featureStats' },
] as const;

export function LoginPageClient({
  callbackUrl,
  errorCode,
  refCode,
}: LoginPageClientProps) {
  const t = useTranslations('auth');

  return (
    <div className="flex min-h-screen">
      <div className="from-primary via-primary/90 to-primary/80 text-primary-foreground relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br p-12 lg:flex lg:w-1/2">
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

      <div className="bg-background flex flex-1 items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md space-y-8">
          <div className="mb-8 text-center lg:hidden">
            <Link href="/">
              <Logo className="mx-auto h-7 w-auto" />
            </Link>
          </div>

          <LoginForm
            callbackUrl={callbackUrl}
            initialErrorCode={errorCode}
            refCode={refCode}
          />

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
      </div>
    </div>
  );
}
