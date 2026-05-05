'use client';

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { cn } from '@louez/utils';

interface Step {
  id: string;
  title: string;
  description?: string;
}

interface StepperProps {
  steps: Step[];
  currentStep: number;
  onStepClick?: (stepIndex: number) => void;
  className?: string;
}

const SPRING = { type: 'spring', duration: 0.55, bounce: 0 } as const;
const ICON_SPRING = { type: 'spring', duration: 0.3, bounce: 0 } as const;

export function Stepper({
  steps,
  currentStep,
  onStepClick,
  className,
}: StepperProps) {
  const progress = steps.length > 1 ? currentStep / (steps.length - 1) : 0;

  return (
    <nav aria-label="Progress" className={cn('w-full', className)}>
      {/* Desktop */}
      <div className="hidden sm:block">
        <ol className="relative flex items-start">
          {/* Track (background) — spans from center of first chip to center of last chip */}
          <span
            aria-hidden
            className="bg-border absolute top-3 h-px"
            style={{
              left: `${50 / steps.length}%`,
              right: `${50 / steps.length}%`,
            }}
          />
          {/* Track (filled) */}
          <motion.span
            aria-hidden
            className="bg-primary absolute top-3 h-px origin-left"
            style={{
              left: `${50 / steps.length}%`,
              right: `${50 / steps.length}%`,
            }}
            initial={false}
            animate={{ scaleX: progress }}
            transition={SPRING}
          />

          {steps.map((step, index) => {
            const isCompleted = index < currentStep;
            const isCurrent = index === currentStep;
            const isReachable = isCompleted || isCurrent;
            const isClickable = !!onStepClick && isReachable;

            return (
              <li
                key={step.id}
                className="relative z-10 flex flex-1 justify-center"
              >
                <button
                  type="button"
                  onClick={() => isClickable && onStepClick?.(index)}
                  disabled={!isClickable}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cn(
                    'group relative -my-2 flex flex-col items-center gap-2 px-2 py-2',
                    isClickable && 'cursor-pointer active:scale-[0.98]',
                    !isReachable && 'opacity-100',
                  )}
                  style={{
                    transitionProperty: 'opacity, transform',
                    transitionDuration: '200ms',
                  }}
                >
                  {/* Chip */}
                  <span
                    className={cn(
                      'bg-background relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] leading-none font-medium tabular-nums',
                      'transition-[background-color,color,box-shadow,border-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
                      isCompleted
                        ? 'bg-primary text-primary-foreground'
                        : isCurrent
                          ? 'bg-primary text-primary-foreground shadow-[0_0_0_1.5px_color-mix(in_oklab,var(--color-primary)_15%,transparent)]'
                          : 'bg-background text-muted-foreground border-border border',
                    )}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {isCompleted ? (
                        <motion.span
                          key="check"
                          initial={{
                            scale: 0.25,
                            opacity: 0,
                            filter: 'blur(4px)',
                          }}
                          animate={{
                            scale: 1,
                            opacity: 1,
                            filter: 'blur(0px)',
                          }}
                          exit={{
                            scale: 0.25,
                            opacity: 0,
                            filter: 'blur(4px)',
                          }}
                          transition={ICON_SPRING}
                          className="absolute inset-0 flex items-center justify-center leading-none"
                        >
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </motion.span>
                      ) : (
                        <motion.span
                          key="num"
                          initial={{
                            scale: 0.25,
                            opacity: 0,
                            filter: 'blur(4px)',
                          }}
                          animate={{
                            scale: 1,
                            opacity: 1,
                            filter: 'blur(0px)',
                          }}
                          exit={{
                            scale: 0.25,
                            opacity: 0,
                            filter: 'blur(4px)',
                          }}
                          transition={ICON_SPRING}
                          className="absolute inset-0 flex items-center justify-center leading-none"
                        >
                          {index + 1}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>

                  {/* Label */}
                  <span className="relative flex flex-col items-center pb-1">
                    <span
                      className={cn(
                        'relative text-[13px] leading-tight tracking-tight whitespace-nowrap',
                        'transition-colors duration-200 ease-out',
                        isCurrent
                          ? 'text-foreground font-medium'
                          : isCompleted
                            ? 'text-foreground/80'
                            : 'text-muted-foreground',
                      )}
                    >
                      {step.title}
                    </span>
                    {step.description && (
                      <span className="text-muted-foreground/80 mt-0.5 text-[11px] leading-tight tracking-tight whitespace-nowrap">
                        {step.description}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Mobile */}
      <div className="sm:hidden">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-foreground text-sm font-medium tracking-tight">
            {steps[currentStep]?.title}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {currentStep + 1} / {steps.length}
          </span>
        </div>
        <div className="bg-border/60 relative h-[2px] w-full overflow-hidden rounded-full">
          <motion.span
            aria-hidden
            className="bg-primary absolute inset-y-0 left-0 rounded-full"
            initial={false}
            animate={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
            transition={SPRING}
          />
        </div>
        {steps[currentStep]?.description && (
          <p className="text-muted-foreground mt-1.5 text-xs">
            {steps[currentStep]?.description}
          </p>
        )}
      </div>
    </nav>
  );
}

interface StepContentProps {
  children: ReactNode;
  className?: string;
  direction?: 'forward' | 'backward';
}

export function StepContent({
  children,
  className,
  direction = 'forward',
}: StepContentProps) {
  return (
    <motion.div
      initial={{
        opacity: 0,
        x: direction === 'forward' ? 16 : -16,
        filter: 'blur(4px)',
      }}
      animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
      transition={{ type: 'spring', duration: 0.45, bounce: 0 }}
      className={className}
      style={{ willChange: 'transform, opacity, filter' }}
    >
      {children}
    </motion.div>
  );
}

interface StepActionsProps {
  children: ReactNode;
  className?: string;
  position?: 'sticky' | 'fixed';
}

export function StepActions({
  children,
  className,
  position = 'sticky',
}: StepActionsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const showScrollBorder = useShowScrollBorder(ref);

  return (
    <div
      ref={ref}
      className={cn(
        'bottom-0 z-20 flex items-center justify-between gap-3 border-t px-4 py-4 backdrop-blur-2xl transition-colors sm:px-6 lg:px-8',
        showScrollBorder
          ? 'border-border bg-background/70'
          : 'bg-background/70 border-transparent',
        position === 'fixed'
          ? 'fixed inset-x-0'
          : 'sticky -mx-4 sm:-mx-6 lg:-mx-8',
        className,
      )}
    >
      {children}
    </div>
  );
}

function useShowScrollBorder(ref: RefObject<HTMLElement | null>) {
  const [showScrollBorder, setShowScrollBorder] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const scrollTarget = getScrollTarget(element);
    const scrollElement: HTMLElement | null =
      scrollTarget === window ? null : (scrollTarget as HTMLElement);

    const update = () => {
      const scrollTop = !scrollElement
        ? window.scrollY
        : scrollElement.scrollTop;
      const clientHeight = !scrollElement
        ? window.innerHeight
        : scrollElement.clientHeight;
      const scrollHeight = !scrollElement
        ? document.documentElement.scrollHeight
        : scrollElement.scrollHeight;
      const canScrollFurther = scrollTop + clientHeight < scrollHeight - 1;

      setShowScrollBorder(canScrollFurther);
    };

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);

    update();
    scrollTarget.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    resizeObserver?.observe(element);

    if (!scrollElement) {
      resizeObserver?.observe(document.documentElement);
      if (document.body) resizeObserver?.observe(document.body);
    } else {
      resizeObserver?.observe(scrollElement);
    }

    return () => {
      scrollTarget.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      resizeObserver?.disconnect();
    };
  }, [ref]);

  return showScrollBorder;
}

function getScrollTarget(element: HTMLElement): Window | HTMLElement {
  let parent = element.parentElement;

  while (parent) {
    const { overflowY } = window.getComputedStyle(parent);

    if (
      /(auto|scroll|overlay)/.test(overflowY) &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }

    parent = parent.parentElement;
  }

  return window;
}
