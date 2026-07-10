'use client';

import { usePathname } from 'next/navigation';

import { useTranslations } from 'next-intl';

import { Logo } from '@louez/ui';
import { cn } from '@louez/utils';

import {
  OnboardingPreviewProvider,
  type OnboardingPreviewState,
} from '../_lib/preview-context';
import { type OnboardingStep, getOnboardingStepIndex } from '../_lib/steps';
import { DashboardPreview } from './dashboard-preview';
import { StorefrontPreview } from './storefront-preview';

export function OnboardingShell({
  children,
  steps,
  initialPreview,
}: {
  children: React.ReactNode;
  steps: OnboardingStep[];
  initialPreview?: Partial<OnboardingPreviewState>;
}) {
  const pathname = usePathname();
  const t = useTranslations('onboarding');
  const stepIndex = getOnboardingStepIndex(steps, pathname);
  const currentStepIndex = stepIndex < 0 ? 0 : stepIndex;
  const isProfileStep = pathname === '/onboarding/profile';

  return (
    <OnboardingPreviewProvider initial={initialPreview}>
      <div className="dashboard bg-background flex min-h-svh">
        {/* Left: form column */}
        <div className="flex w-full flex-col lg:flex-1">
          <header className="px-6 pt-8 lg:px-12">
            <Logo className="h-5 w-auto" />
          </header>

          <main className="flex flex-1 flex-col justify-center px-6 py-10 lg:px-12">
            <div className="mx-auto w-full max-w-md">
              <div
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={steps.length}
                aria-valuenow={currentStepIndex + 1}
                aria-label={t('welcome.description')}
                className="mb-10 flex gap-1.5"
              >
                {steps.map((step, index) => (
                  <div
                    key={step.path}
                    className={cn(
                      'h-[4px] flex-1 rounded-full transition-colors duration-500',
                      index <= currentStepIndex ? 'bg-foreground' : 'bg-border',
                    )}
                  />
                ))}
              </div>

              {children}
            </div>
          </main>

          <footer className="px-6 pb-8 lg:px-12">
            <p className="text-muted-foreground text-xs">
              © Louez {new Date().getFullYear()}
            </p>
          </footer>
        </div>

        {/* Right: live preview, bleeds off the right edge like the moodboard */}
        <aside className="bg-muted/30 relative hidden flex-1 items-center overflow-hidden border-l lg:flex lg:flex-1">
          <div className="w-216 shrink-0 pl-10 xl:pl-16">
            {isProfileStep ? <DashboardPreview /> : <StorefrontPreview />}
          </div>
        </aside>
      </div>
    </OnboardingPreviewProvider>
  );
}
