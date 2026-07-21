'use client';

import { useEffect, useRef } from 'react';

import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Separator,
} from '@louez/ui';
import { cn } from '@louez/utils';

import { AdvisorInput } from '@/components/storefront/advisor/advisor-input';
import { AdvisorMessages } from '@/components/storefront/advisor/advisor-messages';
import { useAdvisor, useAdvisorRuntime } from '@/contexts/advisor-context';
import { useCart } from '@/contexts/cart-context';

import type { CheckoutAdvisorGate } from '../hooks/use-checkout-advisor-gate';

/** Id of the confirm-step submit button, focused after validation. */
export const CHECKOUT_SUBMIT_ID = 'checkout-confirm-submit';

type CheckoutAdvisorVerificationPanelProps = {
  gate: CheckoutAdvisorGate;
};

/**
 * Inline, required-mode advisor verification, rendered at the top of the
 * checkout confirm step. It drives the SAME conversation as the floating
 * widget (the runtime lives in AdvisorProvider), so the moment the advisor
 * validates the cart the confirm button enables automatically. While this
 * inline surface is showing it steps the floating surface aside so only one
 * chat is ever visible.
 */
export const CheckoutAdvisorVerificationPanel = ({
  gate,
}: CheckoutAdvisorVerificationPanelProps) => {
  const t = useTranslations('storefront.checkout.advisor');
  const tAdvisor = useTranslations('storefront.advisor');
  const { setInlineActive, close } = useAdvisor();
  const { messages, isLoading, hasError, errorCode, send, welcomeMessage } =
    useAdvisorRuntime();
  const { items } = useCart();
  const scrollRef = useRef<HTMLDivElement>(null);

  // True exactly when this component renders its inline chat surface.
  const showsSurface = gate.isActive && gate.isRequired && items.length > 0;

  // Single-surface rule: while the inline surface is showing, dismiss any open
  // floating panel and suppress the launcher. Kept in sync with `showsSurface`
  // so the floating widget stays available in recommended/optional mode (where
  // this component renders nothing) — the effect must not claim the lock when
  // there is no inline surface on screen.
  useEffect(() => {
    if (!showsSurface) return;
    setInlineActive(true);
    close();
    return () => setInlineActive(false);
  }, [showsSurface, setInlineActive, close]);

  // Inline auto-scroll (own effect — not the floating panel's isOpen-gated one).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  if (!showsSurface) return null;

  const scrollToSubmit = () => {
    const el = document.getElementById(CHECKOUT_SUBMIT_ID);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => el.focus(), 300);
  };

  const started = messages.length > 0;
  const isStale = gate.validationStale;
  const isChecking = gate.isStatusLoading && !started;
  const isRateLimited = errorCode.startsWith('rate_limit');
  const isUnavailable = errorCode === 'credits_exhausted';
  const errorMessage = hasError
    ? isRateLimited
      ? tAdvisor('errors.rateLimited')
      : isUnavailable
        ? tAdvisor('errors.unavailable')
        : tAdvisor('errors.generic')
    : null;

  return (
    <>
      {/* Persistent live region: announces the state change to screen readers
          even though the validated view is a different subtree. */}
      <div className="sr-only" role="status" aria-live="polite">
        {gate.isValidated ? t('validatedTitle') : ''}
      </div>

      {gate.isValidated ? (
        <Card className="mb-4 border-success/40">
          <CardContent className="flex items-center gap-3 py-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {t('validatedTitle')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('validatedDescription')}
              </p>
            </div>
            <Button
              type="button"
              variant="success-outline"
              size="sm"
              className="ml-auto shrink-0"
              onClick={scrollToSubmit}
            >
              {t('continueToPayment')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card
          className={cn('mb-4', isStale ? 'border-warning/40' : 'border-primary/30')}
        >
          <CardContent className="space-y-4 pt-6">
            {/* Header */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <ShieldCheck className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t('requiredTitle')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('requiredDescription')}
                </p>
              </div>
              <Badge variant="info" className="ml-auto shrink-0">
                {t('badgeRequired')}
              </Badge>
            </div>

            {/* Notice, or the re-verification prompt after a cart/date change */}
            {isStale ? (
              <Alert variant="warning">
                <AlertTitle>{t('staleTitle')}</AlertTitle>
                <AlertDescription>{t('staleDescription')}</AlertDescription>
              </Alert>
            ) : (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
                {t('verifyNotice')}
              </div>
            )}

            <Separator />

            {/* Transcript (single aria-live region for this surface) */}
            <div
              ref={scrollRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label={t('transcriptLabel')}
              tabIndex={0}
              className="max-h-[min(60vh,420px)] overflow-y-auto pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {isChecking ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('statusChecking')}
                </div>
              ) : (
                <AdvisorMessages
                  messages={messages}
                  isLoading={isLoading}
                  welcomeText={welcomeMessage || tAdvisor('welcome')}
                />
              )}

              {/* Starter chip before the first exchange */}
              {!isChecking && !started && (
                <button
                  type="button"
                  onClick={() => send(tAdvisor('validateChip'))}
                  className={cn(
                    'mt-3 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/5 px-3.5 py-2',
                    'text-[13px] font-medium text-primary transition-colors hover:bg-primary/10',
                  )}
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  {tAdvisor('validateChip')}
                </button>
              )}
            </div>

            {/* Error banner */}
            {errorMessage && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
              >
                {errorMessage}
              </div>
            )}

            {/* Composer + AI transparency note */}
            <AdvisorInput onSend={send} isLoading={isLoading} className="mx-0" />
            <p className="text-center text-[10px] text-muted-foreground/70">
              {tAdvisor('disclaimer')}
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
};
