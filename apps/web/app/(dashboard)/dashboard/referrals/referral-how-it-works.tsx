'use client';

import { HelpCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Popover, PopoverContent, PopoverTrigger } from '@louez/ui';

import { formatCurrency } from '@/lib/utils';

interface ReferralHowItWorksProps {
  referrerReward: number;
  referredReward: number;
  referrerRewardKind: 'free_reservations' | 'invoice_credit';
  minQualifyingAmountCents: number;
  currency: string;
}

/**
 * A "?" help affordance that opens a popover explaining how the referral program works —
 * notably that only online (Stripe) payments unlock the Referrer Reward, not manual ones.
 */
export function ReferralHowItWorks({
  referrerReward,
  referredReward,
  referrerRewardKind,
  minQualifyingAmountCents,
  currency,
}: ReferralHowItWorksProps) {
  const t = useTranslations('dashboard.referrals.howItWorks');
  const minAmount = formatCurrency(
    minQualifyingAmountCents / 100,
    currency.toUpperCase(),
  );

  const steps = [
    t('step1'),
    t('step2', { count: referredReward }),
    referrerRewardKind === 'invoice_credit'
      ? t('step3InvoiceCredit', { minAmount })
      : t('step3', { count: referrerReward, minAmount }),
  ];

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t('open')}
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        }
      />
      <PopoverContent align="start" className="w-80">
        <div className="space-y-3 text-sm">
          <p className="text-base font-semibold">{t('title')}</p>
          <ol className="space-y-2.5">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="bg-primary/10 text-primary flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            {t('note')}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
