import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { resolveSignupOrigin } from '@/lib/acquisition/signup-origin';
import { getInstanceConfig } from '@/lib/deployment';
import { getReferralInviteContext } from '@/lib/referral/invite';

import { LoginPageClient } from './_components/login-page-client';
import { resolveSignInMethods } from './_components/sign-in-methods';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');

  return {
    title: t('login'),
    description: t('loginDescription'),
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const [referral, signupOrigin] = await Promise.all([
    getReferralInviteContext(),
    searchParams.then(({ from }) => resolveSignupOrigin(from)),
  ]);
  const signInMethods = resolveSignInMethods(getInstanceConfig());

  return (
    <Suspense>
      <LoginPageClient
        referral={referral}
        signupOrigin={signupOrigin}
        signInMethods={signInMethods}
      />
    </Suspense>
  );
}
