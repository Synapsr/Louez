'use client';

import type { UIMessage } from '@ai-sdk/react';
import { useTranslations } from 'next-intl';

import { cn } from '@louez/utils';

import { isVerificationKickoff } from '@/lib/ai/advisor/kickoff';

import { AdvisorAssistantAvatar } from './advisor-assistant-avatar';
import { AdvisorProductCards } from './advisor-product-cards';
import type { AdvisorRecommendedProduct } from './advisor-product-cards';

type AdvisorMessagesProps = {
  messages: UIMessage[];
  isLoading: boolean;
  /** Static assistant-styled welcome bubble shown before any exchange. */
  welcomeText: string;
  /** Suppress the welcome bubble (required-mode inline verification). */
  hideWelcome?: boolean;
};

export const AdvisorMessages = ({
  messages,
  isLoading,
  welcomeText,
  hideWelcome = false,
}: AdvisorMessagesProps) => {
  const t = useTranslations('storefront.advisor');

  // The hidden verification kickoff is a real user turn (persisted + sent to
  // the model) but must never render as a customer message on any surface.
  const visibleMessages = messages.filter(
    (message) => !isVerificationKickoff(message),
  );

  return (
    <div className="space-y-4 pb-2">
      {!hideWelcome && (
        <div className="flex justify-start">
          <AdvisorAssistantAvatar />
          <div className="max-w-[85%] pt-0.5 text-sm leading-relaxed text-foreground">
            {welcomeText}
          </div>
        </div>
      )}

      {visibleMessages.map((message) => (
        <div
          key={message.id}
          className={cn(
            'flex',
            message.role === 'user' ? 'justify-end' : 'justify-start',
          )}
        >
          {message.role === 'assistant' && <AdvisorAssistantAvatar />}
          <div
            className={cn(
              'max-w-[85%] text-sm leading-relaxed',
              message.role === 'user'
                ? 'rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-primary-foreground'
                : 'pt-0.5 text-foreground',
            )}
          >
            {message.parts.map((part, index) => {
              if (part.type === 'text') {
                return (
                  <p key={index} className="whitespace-pre-wrap">
                    {part.text}
                  </p>
                );
              }
              if (
                part.type === 'tool-recommend_products' &&
                part.state === 'output-available'
              ) {
                const output = part.output as {
                  products?: AdvisorRecommendedProduct[];
                };
                return (
                  <AdvisorProductCards
                    key={index}
                    products={output.products ?? []}
                  />
                );
              }
              return null;
            })}
          </div>
        </div>
      ))}

      {isLoading && messages[messages.length - 1]?.role === 'user' && (
        <div className="flex items-start">
          <AdvisorAssistantAvatar />
          <span className="flex gap-1.5 pt-2.5" aria-hidden="true">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:300ms]" />
          </span>
          <span className="sr-only">{t('typing')}</span>
        </div>
      )}
    </div>
  );
};
