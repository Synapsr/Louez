'use client';

import type { UIMessage } from '@ai-sdk/react';
import { Sparkles } from 'lucide-react';

import { cn } from '@louez/utils';

import { AdvisorProductCards } from './advisor-product-cards';
import type { AdvisorRecommendedProduct } from './advisor-product-cards';

type AdvisorMessagesProps = {
  messages: UIMessage[];
  isLoading: boolean;
  /** Static assistant-styled welcome bubble shown before any exchange. */
  welcomeText: string;
};

const AssistantAvatar = () => (
  <div className="mr-2.5 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10">
    <Sparkles className="h-3 w-3 text-primary" />
  </div>
);

export function AdvisorMessages({
  messages,
  isLoading,
  welcomeText,
}: AdvisorMessagesProps) {
  return (
    <div className="space-y-4 pb-2">
      <div className="flex justify-start">
        <AssistantAvatar />
        <div className="max-w-[85%] pt-0.5 text-sm leading-relaxed text-foreground">
          {welcomeText}
        </div>
      </div>

      {messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            'flex',
            message.role === 'user' ? 'justify-end' : 'justify-start',
          )}
        >
          {message.role === 'assistant' && <AssistantAvatar />}
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
          <AssistantAvatar />
          <span className="flex gap-1.5 pt-2.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:300ms]" />
          </span>
        </div>
      )}
    </div>
  );
}
