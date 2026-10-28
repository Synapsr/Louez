'use client';

import { useEffect, useRef } from 'react';

import { UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePostHog } from 'posthog-js/react';

import {
  referralAnalyticsBaseProperties,
  referralAnalyticsEvents,
} from '@/lib/referral/analytics-events';
import type { ReferralInviteContext } from '@/lib/referral/invite';
import type { SignupOrigin } from '@/lib/utils/signup-origin';

import { LoginForm } from './login-form';
import { LoginLegalNotice } from './login-legal-notice';
import { LoginSocialProof } from './login-social-proof';
import type { SignInMethods } from './sign-in-methods';

interface LoginPageClientProps {
  referral: ReferralInviteContext | null;
  /** Where the visitor came from, so the entry step can greet them for it. */
  signupOrigin: SignupOrigin | null;
  signInMethods: SignInMethods;
}

export const LoginPageClient = ({
  referral,
  signupOrigin,
  signInMethods,
}: LoginPageClientProps) => {
  const t = useTranslations('auth');
  const posthog = usePostHog();
  const hasTrackedReferralInvite = useRef(false);

  useEffect(() => {
    if (!referral || hasTrackedReferralInvite.current) return;

    hasTrackedReferralInvite.current = true;
    posthog.capture(referralAnalyticsEvents.inviteLanded, {
      ...referralAnalyticsBaseProperties,
      placement: 'auth_login',
      has_referrer_name: Boolean(referral.referrerName),
      referred_reward_free_reservations: referral.freeReservations,
    });
  }, [posthog, referral]);

  return (
    <div className="flex min-h-screen p-2">
      <div className="bg-background relative flex flex-1 items-center justify-center p-6 lg:p-12 lg:pb-4">
        <div className="w-full max-w-md space-y-4">
          {referral ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
              <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-amber-800 dark:text-amber-200">
                {referral.referrerName
                  ? t('referralBanner', { storeName: referral.referrerName })
                  : t('referralBannerGeneric')}
              </p>
            </div>
          ) : null}

          <LoginForm methods={signInMethods} signupOrigin={signupOrigin} />
        </div>

        <LoginLegalNotice />
      </div>

      <div className="bg-primary text-primary-foreground relative hidden flex-col items-center justify-center overflow-hidden rounded-2xl p-12 lg:flex lg:w-1/2">
        <div className="relative z-10">
          <LoginSocialProof />
        </div>
      </div>
    </div>
  );
};
