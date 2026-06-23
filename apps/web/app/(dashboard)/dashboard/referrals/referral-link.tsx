'use client';

import { useState } from 'react';

import { Check, Copy, Crown, Gift } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePostHog } from 'posthog-js/react';

import { Button } from '@louez/ui';
import { Input } from '@louez/ui';
import { toastManager } from '@louez/ui';

import {
  referralAnalyticsBaseProperties,
  referralAnalyticsEvents,
} from '@/lib/referral/analytics-events';
import { formatCurrency } from '@/lib/utils';

interface ReferralLinkProps {
  storeId: string;
  referralUrl: string;
  referrerReward: number;
  referredReward: number;
  rewardKind: 'free_reservations' | 'invoice_credit';
  rewardValueCents: number;
  currency: string;
}

export const ReferralLink = ({
  storeId,
  referralUrl,
  referrerReward,
  referredReward,
  rewardKind,
  rewardValueCents,
  currency,
}: ReferralLinkProps) => {
  const t = useTranslations('dashboard.referrals.link');
  const posthog = usePostHog();
  const [copied, setCopied] = useState(false);

  const rewardValue = formatCurrency(
    rewardValueCents / 100,
    currency.toUpperCase(),
  );

  const writeClipboard = async (value: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.className = 'sr-only';
    document.body.appendChild(textarea);
    textarea.select();

    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (!copied) {
      throw new Error('Clipboard copy failed');
    }
  };

  const copyToClipboard = async () => {
    try {
      await writeClipboard(referralUrl);
      posthog.capture(referralAnalyticsEvents.linkCopied, {
        ...referralAnalyticsBaseProperties,
        placement: 'dashboard_referrals',
        referrer_store_id: storeId,
        reward_kind: rewardKind,
        referrer_reward_free_reservations: referrerReward,
        referred_reward_free_reservations: referredReward,
        reward_value_cents: rewardValueCents,
        currency,
      });
      setCopied(true);
      toastManager.add({ title: t('linkCopied'), type: 'success' });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      posthog.capture(referralAnalyticsEvents.linkCopyFailed, {
        ...referralAnalyticsBaseProperties,
        placement: 'dashboard_referrals',
        referrer_store_id: storeId,
        reward_kind: rewardKind,
        referrer_reward_free_reservations: referrerReward,
        referred_reward_free_reservations: referredReward,
        reward_value_cents: rewardValueCents,
        currency,
      });
      toastManager.add({ title: t('linkCopyFailed'), type: 'error' });
    }
  };

  return (
    <div className="border-primary/20 bg-primary/5 rounded-xl border p-6 md:p-8">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-5">
          <div className="bg-primary flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-lg">
            <Gift className="text-primary-foreground h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">
              {t('title')}
            </h2>
            <p className="text-muted-foreground text-sm">{t('description')}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <Crown className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
            {rewardKind === 'invoice_credit'
              ? t('rewardInvoiceCredit', {
                  referred: referredReward,
                  rewardValue,
                })
              : t('reward', {
                  referrer: referrerReward,
                  referred: referredReward,
                  rewardValue,
                })}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={referralUrl}
            readOnly
            aria-label={t('inputLabel')}
            className="border-primary/20 bg-background min-w-0 text-sm"
          />
          <Button
            onClick={copyToClipboard}
            className="shadow-primary/20 w-full shrink-0 gap-2 shadow-sm sm:w-auto"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {t('copyLink')}
          </Button>
        </div>
      </div>
    </div>
  );
};
