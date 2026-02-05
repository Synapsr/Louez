'use client'

import { cn } from '@louez/utils'
import { Check } from 'lucide-react'

interface Step {
  id: string
  title: string
  description?: string
}

interface StepperProps {
  steps: Step[]
  currentStep: number
  onStepClick?: (stepIndex: number) => void
  className?: string
}

export function Stepper({ steps, currentStep, onStepClick, className }: StepperProps) {
  return (
    <nav aria-label="Progress" className={className}>
      <ol className="flex w-full">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep
          const isCurrent = index === currentStep
          const isClickable = onStepClick && (isCompleted || isCurrent)
          const isLast = index === steps.length - 1

          return (
            <li
              key={step.id}
              className={cn(
                'flex items-center',
                isLast ? 'flex-none' : 'flex-1'
              )}
            >
              {/* Step indicator and label */}
              <button
                type="button"
                onClick={() => isClickable && onStepClick?.(index)}
                disabled={!isClickable}
                className={cn(
                  'group relative z-10 flex flex-col items-center',
                  isClickable && 'cursor-pointer'
                )}
              >
                {/* Circle indicator */}
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-all duration-200',
                    isCompleted && 'bg-primary shadow-sm',
                    isCurrent && 'border-2 border-primary bg-background shadow-sm',
                    !isCompleted && !isCurrent && 'border-2 border-muted bg-background'
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4 text-primary-foreground" />
                  ) : (
                    <span
                      className={cn(
                        isCurrent ? 'text-primary' : 'text-muted-foreground'
                      )}
                    >
                      {index + 1}
                    </span>
                  )}
                </span>

                {/* Step label - below the circle */}
                <span className="mt-2 hidden flex-col items-center text-center sm:flex">
                  <span
                    className={cn(
                      'text-sm font-medium leading-tight whitespace-nowrap',
                      isCurrent
                        ? 'text-primary'
                        : isCompleted
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                    )}
                  >
                    {step.title}
                  </span>
                  {step.description && (
                    <span className="mt-0.5 text-xs text-muted-foreground whitespace-nowrap">
                      {step.description}
                    </span>
                  )}
                </span>
              </button>

              {/* Connector line */}
              {!isLast && (
                <div className="flex-1 mx-2 sm:mx-4">
                  <div
                    className={cn(
                      'h-0.5 w-full transition-colors duration-300',
                      isCompleted ? 'bg-primary' : 'bg-muted'
                    )}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {/* Mobile step title */}
      <div className="mt-4 text-center sm:hidden">
        <span className="text-sm font-medium text-primary">
          {steps[currentStep]?.title}
        </span>
        <span className="text-xs text-muted-foreground ml-2">
          ({currentStep + 1}/{steps.length})
        </span>
      </div>
    </nav>
  )
}

interface StepContentProps {
  children: React.ReactNode
  className?: string
}

export function StepContent({ children, className }: StepContentProps) {
  return (
    <div className={cn('animate-in fade-in-50 slide-in-from-right-5 duration-300', className)}>
      {children}
    </div>
  )
}

interface StepActionsProps {
  children: React.ReactNode
  className?: string
}

export function StepActions({ children, className }: StepActionsProps) {
  return (
    <div className={cn('flex justify-between gap-4 pt-6', className)}>
      {children}
    </div>
  )
}
