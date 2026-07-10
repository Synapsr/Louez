'use client';

import { MessageCircleQuestion } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@louez/utils';

type AdvisorLauncherProps = {
  isOpen: boolean;
  onClick: () => void;
};

/**
 * Floating advisor button. Sits above the mobile cart button (bottom-4) and
 * in the bottom-right corner on desktop where no cart button exists.
 */
export function AdvisorLauncher({ isOpen, onClick }: AdvisorLauncherProps) {
  const t = useTranslations('storefront.advisor');

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('open')}
      className={cn(
        'fixed right-4 bottom-20 z-50 lg:right-6 lg:bottom-6',
        'flex h-14 w-14 items-center justify-center rounded-full',
        'bg-primary text-primary-foreground shadow-lg shadow-primary/25',
        'transition-all duration-200 hover:scale-105 active:scale-95',
        isOpen && 'pointer-events-none scale-90 opacity-0',
      )}
    >
      <MessageCircleQuestion className="h-6 w-6" />
    </button>
  );
}
