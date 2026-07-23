'use client';

import { useEffect, useRef } from 'react';

import type { UIMessage } from '@ai-sdk/react';
import { RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import { cn } from '@louez/utils';

import type { AdvisorIntent } from '@/contexts/advisor-context';

import { AdvisorInput } from './advisor-input';
import { AdvisorMessages } from './advisor-messages';

type AdvisorPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  displayName?: string;
  welcomeMessage?: string;
  intent: AdvisorIntent;
  onIntentConsumed: () => void;
  messages: UIMessage[];
  isLoading: boolean;
  hasError: boolean;
  errorCode: string;
  onSend: (text: string) => void;
  onRestart: () => void;
};

export const AdvisorPanel = ({
  isOpen,
  onClose,
  displayName,
  welcomeMessage,
  intent,
  onIntentConsumed,
  messages,
  isLoading,
  hasError,
  errorCode,
  onSend,
  onRestart,
}: AdvisorPanelProps) => {
  const t = useTranslations('storefront.advisor');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages and while streaming
  useEffect(() => {
    const el = scrollRef.current;
    if (el && isOpen) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Escape closes the panel
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleSuggestion = (text: string) => {
    onIntentConsumed();
    onSend(text);
  };

  const isRateLimited = errorCode.startsWith('rate_limit');
  const isUnavailable = errorCode === 'credits_exhausted';
  const errorMessage = hasError
    ? isRateLimited
      ? t('errors.rateLimited')
      : isUnavailable
        ? t('errors.unavailable')
        : t('errors.generic')
    : null;

  const suggestions = [
    { key: 'recommend', prompt: t('suggestions.recommend') },
    { key: 'question', prompt: t('suggestions.question') },
    { key: 'practical', prompt: t('suggestions.practical') },
  ] as const;

  return (
    <>
      {/* Mobile backdrop */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 lg:hidden',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={displayName || t('title')}
        className={cn(
          'fixed z-50 flex flex-col overflow-hidden border bg-background shadow-2xl',
          // Mobile: bottom sheet
          'inset-x-0 bottom-0 h-[85vh] rounded-t-2xl',
          // Desktop: anchored panel
          'lg:inset-x-auto lg:right-6 lg:bottom-6 lg:h-[min(640px,85vh)] lg:w-[400px] lg:rounded-2xl',
          'transition-all duration-200',
          isOpen
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-4 opacity-0',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium leading-none">
                {displayName || t('title')}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t('subtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onRestart}
                aria-label={t('restart')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label={t('close')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          <AdvisorMessages
            messages={messages}
            isLoading={isLoading}
            welcomeText={welcomeMessage || t('welcome')}
          />

          {/* Suggestion chips before the first exchange */}
          {messages.length === 0 && (
            <div className="mt-4 flex flex-col items-start gap-2">
              {intent === 'checkout' && (
                <button
                  type="button"
                  onClick={() => handleSuggestion(t('validateChip'))}
                  className={cn(
                    'flex items-center gap-2 rounded-full border border-primary/40 bg-primary/5 px-3.5 py-2',
                    'text-left text-[13px] font-medium text-primary transition-colors',
                    'hover:bg-primary/10',
                  )}
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  {t('validateChip')}
                </button>
              )}
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.key}
                  type="button"
                  onClick={() => handleSuggestion(suggestion.prompt)}
                  className={cn(
                    'rounded-full border border-border/60 px-3.5 py-2 text-left text-[13px]',
                    'text-muted-foreground transition-colors',
                    'hover:border-primary/30 hover:text-foreground',
                  )}
                >
                  {suggestion.prompt}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Error banner */}
        {errorMessage && (
          <div className="mx-3 mb-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            {errorMessage}
          </div>
        )}

        {/* Input + AI transparency note */}
        <AdvisorInput onSend={onSend} isLoading={isLoading} />
        <p className="pb-2 text-center text-[10px] text-muted-foreground/70">
          {t('disclaimer')}
        </p>
      </div>
    </>
  );
};
