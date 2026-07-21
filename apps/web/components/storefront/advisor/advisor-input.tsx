'use client';

import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import { cn } from '@louez/utils';
import { AI_ADVISOR_MESSAGE_MAX_LENGTH } from '@louez/validations';

type AdvisorInputProps = {
  onSend: (text: string) => void;
  isLoading: boolean;
  /** Overrides the default horizontal margin (floating panel vs inline). */
  className?: string;
};

export const AdvisorInput = ({
  onSend,
  isLoading,
  className,
}: AdvisorInputProps) => {
  const t = useTranslations('storefront.advisor');
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput('');
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const hasInput = input.trim().length > 0;

  return (
    <div
      className={cn(
        'mb-1 flex items-end gap-2 rounded-xl border px-3 py-1.5',
        'transition-all duration-200',
        'focus-within:border-primary/30 focus-within:shadow-[0_0_0_3px] focus-within:shadow-primary/5',
        className ?? 'mx-3',
      )}
    >
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('placeholder')}
        aria-label={t('placeholder')}
        // readOnly (not disabled) while loading keeps the field focusable, so
        // focus and the mobile keyboard survive between turns.
        readOnly={isLoading}
        aria-disabled={isLoading}
        maxLength={AI_ADVISOR_MESSAGE_MAX_LENGTH}
        rows={1}
        className={cn(
          'field-sizing-content max-h-[100px] min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-sm',
          'placeholder:text-muted-foreground outline-none',
          isLoading && 'opacity-50',
        )}
      />
      <Button
        type="button"
        size="icon"
        aria-label={t('send')}
        className={cn(
          'mb-0.5 h-8 w-8 shrink-0 rounded-lg transition-all duration-200',
          hasInput && !isLoading
            ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25'
            : '',
        )}
        disabled={!hasInput || isLoading}
        onClick={handleSend}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
    </div>
  );
};
