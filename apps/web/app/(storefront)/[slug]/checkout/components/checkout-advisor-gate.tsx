'use client';

import { useState } from 'react';

import { CheckCircle2, MessageCircleQuestion, ShieldCheck, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Card, CardContent } from '@louez/ui';
import { cn } from '@louez/utils';

import type { CheckoutAdvisorGate } from '../hooks/use-checkout-advisor-gate';

type CheckoutAdvisorGateProps = {
  gate: CheckoutAdvisorGate;
};

/**
 * Advisor participation in the confirm step:
 * - required mode: blocking card until the advisor validates the cart
 * - recommended mode: dismissible, non-blocking suggestion
 */
export function CheckoutAdvisorGateCard({ gate }: CheckoutAdvisorGateProps) {
  const t = useTranslations('storefront.checkout.advisor');
  const [dismissed, setDismissed] = useState(false);

  if (!gate.isActive) return null;

  // Recommended mode: light, dismissible banner
  if (!gate.isRequired) {
    if (dismissed) return null;
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
  }

  // Required mode: blocking gate card
  return (
    <Card
      className={cn(
        'mb-4',
        gate.isValidated ? 'border-green-500/40' : 'border-primary/30',
      )}
    >
      <CardContent className="flex items-center gap-3 py-4">
        {gate.isValidated ? (
          <>
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-500" />
            <div className="flex-1">
              <p className="text-sm font-medium">{t('validatedTitle')}</p>
              <p className="text-xs text-muted-foreground">
                {t('validatedDescription')}
              </p>
            </div>
          </>
        ) : (
          <>
            <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">{t('requiredTitle')}</p>
              <p className="text-xs text-muted-foreground">
                {t('requiredDescription')}
              </p>
            </div>
            <Button type="button" onClick={gate.openAdvisor}>
              {t('startVerification')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
