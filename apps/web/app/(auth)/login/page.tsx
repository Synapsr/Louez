import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { getReferralInviteContext } from '@/lib/referral/invite';

import { LoginPageClient } from './_components/login-page-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');

  return {
    title: t('login'),
    description: t('loginDescription'),
  };
}

export default async function LoginPage() {
  const referral = await getReferralInviteContext();

  return (
    <Suspense>
      <LoginPageClient referral={referral} />
    </Suspense>
  );
}
