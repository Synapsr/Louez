'use client';

import { useEffect, useRef, useState } from 'react';

import Link from 'next/link';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Gift, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePostHog } from 'posthog-js/react';

import { cn } from '@louez/utils';

import { orpc } from '@/lib/orpc/react';
import {
  referralAnalyticsBaseProperties,
  referralAnalyticsEvents,
} from '@/lib/referral/analytics-events';
import { formatCurrency } from '@/lib/utils';

interface ReferralNudgeProps {
  className?: string;
}

const REFERRAL_NUDGE_DISMISSED_KEY = 'louez:referral-nudge-dismissed';

/**
 * A discreet, dismissible referral nudge surfaced at a satisfaction moment (e.g. once a
 * reservation is fully paid). Links to the referral hub. Niveau B — contextual, not a
 * permanent banner.
 */
export const ReferralNudge = ({ className }: ReferralNudgeProps) => {
  const t = useTranslations('dashboard.referrals.nudge');
  const posthog = usePostHog();
  const hasTrackedView = useRef(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return (
        typeof window !== 'undefined' &&
        window.localStorage.getItem(REFERRAL_NUDGE_DISMISSED_KEY) === '1'
      );
    } catch {
      return false;
    }
  });

  // Self-contained: the nudge fetches its own reward summary over oRPC so it can be dropped
  // anywhere without threading props through the payment UI. It stays hidden until the
  // (cheap, store-scoped) query resolves, so it never flashes a reward-less teaser.
  const { data: summary } = useQuery(
    orpc.dashboard.referral.getRewardSummary.queryOptions({ input: {} }),
  );

  useEffect(() => {
    if (!summary || hasTrackedView.current) return;

    hasTrackedView.current = true;
    posthog.capture(referralAnalyticsEvents.nudgeViewed, {
      ...referralAnalyticsBaseProperties,
      placement: 'post_payment_reservation_detail',
      reward_kind: summary.rewardKind,
      referrer_reward_free_reservations: summary.referrerReward,
      reward_value_cents: summary.rewardValueCents,
      currency: summary.currency,
      free_reservations_remaining: summary.freeReservationsRemaining,
      free_reservations_granted: summary.freeReservationsGranted,
    });
  }, [posthog, summary]);

  if (dismissed || !summary) return null;

  const rewardValue = formatCurrency(
    summary.rewardValueCents / 100,
    summary.currency.toUpperCase(),
  );

  const dismiss = () => {
    posthog.capture(referralAnalyticsEvents.nudgeDismissed, {
      ...referralAnalyticsBaseProperties,
      placement: 'post_payment_reservation_detail',
      reward_kind: summary.rewardKind,
      referrer_reward_free_reservations: summary.referrerReward,
      reward_value_cents: summary.rewardValueCents,
      currency: summary.currency,
    });
    setDismissed(true);
    try {
      window.localStorage.setItem(REFERRAL_NUDGE_DISMISSED_KEY, '1');
    } catch {}
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-transparent p-4 sm:flex-row sm:items-center dark:border-amber-900/40 dark:from-amber-950/30',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Gift className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t('title')}</p>
          <p className="text-muted-foreground text-xs">
            {summary.rewardKind === 'invoice_credit'
              ? t('descriptionInvoiceCredit', {
                  count: summary.referrerReward,
                  rewardValue,
                })
              : t('description', {
                  count: summary.referrerReward,
                  rewardValue,
                })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:shrink-0">
        <Link
          href="/dashboard/referrals"
          onClick={() => {
            posthog.capture(referralAnalyticsEvents.nudgeClicked, {
              ...referralAnalyticsBaseProperties,
              placement: 'post_payment_reservation_detail',
              reward_kind: summary.rewardKind,
              referrer_reward_free_reservations: summary.referrerReward,
              reward_value_cents: summary.rewardValueCents,
              currency: summary.currency,
            });
          }}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 sm:flex-none dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
        >
          {t('cta')}
          <ArrowRight className="h-3 w-3" />
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="text-muted-foreground/60 hover:text-foreground shrink-0 p-1 transition-colors"
          aria-label={t('dismiss')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
