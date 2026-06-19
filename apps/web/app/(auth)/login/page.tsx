import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { getReferralInviteContext } from '@/lib/referral/invite';
import { sanitizeCallbackUrl } from '@/lib/utils/util.url';

import { LoginPageClient } from './_components/login-page-client';

interface LoginPageProps {
  searchParams: Promise<{
    callbackUrl?: string;
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');

  return {
    title: t('login'),
    description: t('loginDescription'),
  };
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const referral = await getReferralInviteContext();

  return (
    <Suspense>
      <LoginPageClient
        callbackUrl={sanitizeCallbackUrl(params.callbackUrl)}
        referral={referral}
      />
    </Suspense>
  );
}
