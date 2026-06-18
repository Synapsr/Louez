'use client';

import * as React from 'react';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Check,
  Download,
  EllipsisVertical,
  ExternalLink,
  SquarePlus,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  toastManager,
} from '@louez/ui';

import { useInstallPrompt } from '@/hooks/use-install-prompt';
import { useSaveBarVisible } from '@/hooks/use-save-bar';

// Appear a beat after the dashboard has settled, never competing with first paint.
const SHOW_DELAY_MS = 2500;

/**
 * The iOS "Share" glyph (arrow rising out of a box). Lucide has no exact match,
 * so we draw it to keep the instructions faithful to what users see in Safari.
 */
function IosShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2" />
    </svg>
  );
}

export function InstallPrompt() {
  const t = useTranslations('dashboard.installPrompt');
  const { status, promptInstall, dismiss } = useInstallPrompt();
  const saveBarVisible = useSaveBarVisible();
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);
  const [iosSheetOpen, setIosSheetOpen] = React.useState(false);

  React.useEffect(() => {
    if (status === 'hidden') {
      setVisible(false);
      return;
    }
    const id = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [status]);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const outcome = await promptInstall();
      if (outcome === 'accepted') {
        setVisible(false);
        toastManager.add({ title: t('installedToast'), type: 'success' });
      }
    } finally {
      setInstalling(false);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    setIosSheetOpen(false);
    dismiss();
  };

  // Yield to the bottom-anchored save bar so we never cover Save/Cancel.
  const showBanner = visible && status !== 'hidden' && !saveBarVisible;

  const isActionable = status === 'android' || status === 'desktop';
  // Only an embedded in-app webview truly can't install. Every standalone iOS
  // browser (Safari, Chrome, Firefox, Edge…) supports Add to Home Screen since
  // iOS 16.4, so iOS browsers get the instructions sheet rather than a "use
  // Safari" dead end — only the Share location differs (toolbar vs menu).
  const isWebview = status === 'in-app';
  const canShowIosSteps = status === 'ios-safari' || status === 'ios-other';

  const description = isWebview ? t('inApp') : t('subtitle');
  const LeadIcon = isWebview ? ExternalLink : Download;

  return (
    <>
      {/* Persistent live region so screen readers are notified when the
          install offer appears (the content is inserted into a region that
          already exists in the DOM). */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end sm:pr-6"
      >
        <AnimatePresence>
          {showBanner && (
            <motion.div
              className="bg-popover text-popover-foreground pointer-events-auto relative w-full max-w-md rounded-2xl border shadow-lg"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
            >
              <div className="flex items-start gap-3 p-4 pr-10">
                <span className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
                  <LeadIcon className="size-5" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="leading-tight font-medium">{t('title')}</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {description}
                  </p>

                  {isActionable && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={handleInstall}
                        isPending={installing}
                      >
                        <Download />
                        {t('install')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleDismiss}
                      >
                        {t('later')}
                      </Button>
                    </div>
                  )}

                  {canShowIosSteps && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setIosSheetOpen(true)}>
                        {t('ios.cta')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleDismiss}
                      >
                        {t('later')}
                      </Button>
                    </div>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleDismiss}
                  aria-label={t('close')}
                  className="text-muted-foreground hover:text-foreground absolute end-2 top-2"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Sheet open={iosSheetOpen} onOpenChange={(open) => setIosSheetOpen(open)}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{t('ios.title')}</SheetTitle>
            <SheetDescription>{t('subtitle')}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-6 pb-8">
            <InstallStep
              index={1}
              icon={
                status === 'ios-safari' ? (
                  <IosShareIcon className="size-5" />
                ) : (
                  <EllipsisVertical className="size-5" />
                )
              }
              text={
                status === 'ios-safari' ? t('ios.step1') : t('ios.step1Other')
              }
            />
            <InstallStep
              index={2}
              icon={<SquarePlus className="size-5" />}
              text={t('ios.step2')}
            />
            <InstallStep
              index={3}
              icon={<Check className="size-5" />}
              text={t('ios.step3')}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function InstallStep({
  index,
  icon,
  text,
}: {
  index: number;
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium">
        {index}
      </span>
      <span className="text-primary shrink-0">{icon}</span>
      <p className="text-sm">{text}</p>
    </div>
  );
}
