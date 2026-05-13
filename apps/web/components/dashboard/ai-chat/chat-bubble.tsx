'use client';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import { useIsMobile } from '@louez/ui/hooks/use-mobile';
import { SparklesIcon } from '@louez/ui/icons';
import { cn } from '@louez/utils';

import { ChatModal } from './chat-modal';

export function ChatBubble() {
  const [open, setOpen] = useState(false);
  const t = useTranslations('dashboard.aiChat');

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const isMobile = useIsMobile();

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className={cn(
          'bg-background/70 text-muted-foreground hidden h-9 min-w-48 justify-start gap-2 lg:flex',
          'hover:bg-background hover:text-foreground',
        )}
      >
        <SparklesIcon className="size-4" />
        <span className="min-w-0 flex-1 truncate text-left">
          {t('placeholder')}
        </span>
        {/* <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
          {t('badge')}
        </span> */}
        <kbd className="bg-muted text-muted-foreground/70 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium">
          ⌘K
        </kbd>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        onClick={() => setOpen(true)}
        className="lg:hidden"
        aria-label={t('title')}
      >
        <SparklesIcon className="size-4" />
      </Button>
      <ChatModal open={open} onOpenChange={setOpen} />
    </>
  );
}
