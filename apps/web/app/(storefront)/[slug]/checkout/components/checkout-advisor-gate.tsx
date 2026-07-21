'use client';

import { useState } from 'react';

import { MessageCircleQuestion, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';

import type { CheckoutAdvisorGate } from '../hooks/use-checkout-advisor-gate';

type CheckoutAdvisorGateProps = {
  gate: CheckoutAdvisorGate;
};

/**
 * Recommended-mode advisor participation in the confirm step: a dismissible,
 * non-blocking suggestion to open the floating advisor. Required mode is
 * handled inline by CheckoutAdvisorVerificationPanel, not here.
 */
export const CheckoutAdvisorGateCard = ({
  gate,
}: CheckoutAdvisorGateProps) => {
  const t = useTranslations('storefront.checkout.advisor');
  const [dismissed, setDismissed] = useState(false);

  if (!gate.isActive || gate.isRequired || dismissed) return null;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
      <MessageCircleQuestion className="h-4 w-4 shrink-0 text-primary" />
      <p className="flex-1 text-sm text-foreground">{t('recommendedHint')}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={gate.openAdvisor}
      >
        {t('askAdvisor')}
      </Button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('dismiss')}
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};
