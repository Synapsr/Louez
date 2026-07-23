'use client';

import { useEffect, useRef } from 'react';

import Link from 'next/link';

import { Gift } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePostHog } from 'posthog-js/react';

import {
  referralAnalyticsBaseProperties,
  referralAnalyticsEvents,
} from '@/lib/referral/analytics-events';
import type { ReferralInviteContext } from '@/lib/referral/invite';

import { LoginForm } from './login-form';
import { LoginSocialProof } from './login-social-proof';
import type { SignInMethods } from './sign-in-methods';

interface LoginPageClientProps {
  referral: ReferralInviteContext | null;
  signInMethods: SignInMethods;
}

export const LoginPageClient = ({
  referral,
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
              <Gift className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-amber-800 dark:text-amber-200">
                {referral.referrerName
                  ? t('referralBanner', {
                      storeName: referral.referrerName,
                      count: referral.freeReservations,
                    })
                  : t('referralBannerGeneric', {
                      count: referral.freeReservations,
                    })}
              </p>
            </div>
          ) : null}

          <LoginForm methods={signInMethods} />
        </div>

        <p className="text-muted-foreground absolute right-6 bottom-2 left-6 text-center text-[13.5px] lg:right-12 lg:bottom-2.5 lg:left-12">
          {t('termsAgreement')}{' '}
          <Link
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary underline underline-offset-4"
          >
            {t('termsOfService')}
          </Link>{' '}
          {t('and')}{' '}
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary underline underline-offset-4"
          >
            {t('privacyPolicy')}
          </Link>
        </p>
      </div>

      <div className="bg-primary text-primary-foreground relative hidden flex-col items-center justify-center overflow-hidden rounded-2xl p-12 lg:flex lg:w-1/2">
        <div className="relative z-10">
          <LoginSocialProof />
        </div>
      </div>
    </div>
  );
};
