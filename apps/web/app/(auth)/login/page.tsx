import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { getInstanceConfig } from '@/lib/deployment';
import { getReferralInviteContext } from '@/lib/referral/invite';

import { LoginPageClient } from './_components/login-page-client';
import type { SignInMethods } from './_components/sign-in-methods';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');

  return {
    title: t('login'),
    description: t('loginDescription'),
  };
}

export default async function LoginPage() {
  const referral = await getReferralInviteContext();
  const instance = getInstanceConfig();

  const signInMethods: SignInMethods = {
    password: instance.standalone,
    emailOtp: instance.emailConfigured,
    google: instance.googleAuthConfigured,
  };

  // A platform instance without SMTP or Google would otherwise render no
  // sign-in method at all; keep today's OTP form (it surfaces a send error).
  if (!signInMethods.password && !signInMethods.emailOtp && !signInMethods.google) {
    signInMethods.emailOtp = true;
  }

  return (
    <Suspense>
      <LoginPageClient referral={referral} signInMethods={signInMethods} />
    </Suspense>
  );
}
