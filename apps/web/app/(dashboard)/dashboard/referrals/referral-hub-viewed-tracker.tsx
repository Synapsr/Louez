'use client';

import { useEffect, useRef } from 'react';

import { usePostHog } from 'posthog-js/react';

import {
  referralAnalyticsBaseProperties,
  referralAnalyticsEvents,
} from '@/lib/referral/analytics-events';

interface ReferralHubViewedTrackerProps {
  storeId: string;
  totalReferrals: number;
  qualifiedReferrals: number;
  freeReservationsEarned: number;
  rewardValueCents: number;
  freeReservationsRemaining: number;
  rewardKind: 'free_reservations' | 'invoice_credit';
  referrerReward: number;
  referredReward: number;
  minQualifyingAmountCents: number;
  currency: string;
}

export const ReferralHubViewedTracker = ({
  storeId,
  totalReferrals,
  qualifiedReferrals,
  freeReservationsEarned,
  rewardValueCents,
  freeReservationsRemaining,
  rewardKind,
  referrerReward,
  referredReward,
  minQualifyingAmountCents,
  currency,
}: ReferralHubViewedTrackerProps) => {
  const posthog = usePostHog();
  const hasTracked = useRef(false);

  useEffect(() => {
    if (hasTracked.current) return;

    hasTracked.current = true;
    posthog.capture(referralAnalyticsEvents.hubViewed, {
      ...referralAnalyticsBaseProperties,
      placement: 'dashboard_referrals',
      referrer_store_id: storeId,
      total_referrals: totalReferrals,
      qualified_referrals: qualifiedReferrals,
      free_reservations_earned: freeReservationsEarned,
      reward_value_cents: rewardValueCents,
      free_reservations_remaining: freeReservationsRemaining,
      reward_kind: rewardKind,
      referrer_reward_free_reservations: referrerReward,
      referred_reward_free_reservations: referredReward,
      min_qualifying_amount_cents: minQualifyingAmountCents,
      currency,
    });
  }, [
    currency,
    freeReservationsEarned,
    freeReservationsRemaining,
    minQualifyingAmountCents,
    posthog,
    qualifiedReferrals,
    referredReward,
    referrerReward,
    rewardKind,
    rewardValueCents,
    storeId,
    totalReferrals,
  ]);

  return null;
};
