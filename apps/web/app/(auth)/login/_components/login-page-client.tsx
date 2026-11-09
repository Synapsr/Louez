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

      <div className="from-lagon-600 to-lagon-800 text-primary-foreground relative hidden flex-col items-center justify-center overflow-hidden rounded-2xl bg-linear-160 p-12 lg:flex lg:w-1/2">
        {/* Lagon scene: an Écume glow from the top right, a deeper pool at the
            bottom left, and a dot grid that fades out before the text. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="from-ecume/55 absolute -top-1/3 -right-1/4 size-[120%] rounded-full bg-radial to-transparent to-55%" />
          <div className="from-lagon-700 absolute -bottom-1/3 -left-1/3 size-[110%] rounded-full bg-radial to-transparent to-70%" />
          <div className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.1)_1px,transparent_1px)] [mask-image:linear-gradient(180deg,#000,transparent_70%)] bg-size-[22px_22px]" />
        </div>
        <div className="relative z-10">
          <LoginSocialProof />
        </div>
      </div>
    </div>
  );
};
