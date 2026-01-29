'use client'

import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface FloatingSaveBarProps {
  /** Whether the form has unsaved changes */
  isDirty: boolean
  /** Whether the form is currently submitting */
  isLoading: boolean
  /** Callback to reset the form to its initial state */
  onReset: () => void
  /** Optional callback for forms without a wrapping <form> element */
  onSubmit?: () => void
  /** Optional form ID for external submit button */
  formId?: string
  /** Optional additional className */
  className?: string
}

/**
 * A floating save bar that appears at the bottom of the screen when there are unsaved changes.
 * Features a pulsing indicator, cancel and save buttons with smooth slide-up animation.
 *
 * Usage with React Hook Form (inside <Form>):
 * ```tsx
 * <FloatingSaveBar
 *   isDirty={form.formState.isDirty}
 *   isLoading={isPending}
 *   onReset={() => form.reset()}
 * />
 * ```
 *
 * Usage with useState (outside form or with onSubmit):
 * ```tsx
 * <FloatingSaveBar
 *   isDirty={isDirty}
 *   isLoading={isLoading}
 *   onReset={handleReset}
 *   onSubmit={handleSubmit}
 * />
 * ```
 */
export function FloatingSaveBar({
  isDirty,
  isLoading,
  onReset,
  onSubmit,
  formId,
  className,
}: FloatingSaveBarProps) {
  const t = useTranslations('common')

  return (
    <>
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 flex justify-center pb-6 px-4 pointer-events-none transition-all duration-300 ease-out',
          isDirty ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
          className
        )}
      >
        <div className="pointer-events-auto relative flex items-center gap-4 rounded-full bg-zinc-900/90 dark:bg-zinc-800/90 px-5 py-2.5 shadow-lg shadow-black/20 ring-1 ring-white/10 backdrop-blur-xl">
          {/* Status indicator with pulsing animation */}
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
            <span>{t('unsavedChanges')}</span>
          </div>

          {/* Divider */}
          <div className="h-4 w-px bg-zinc-700" />

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReset}
              disabled={isLoading}
              className="text-zinc-300 hover:text-white hover:bg-zinc-800"
            >
              {t('cancel')}
            </Button>
            <Button
              type={onSubmit || formId ? 'button' : 'submit'}
              form={formId}
              size="sm"
              disabled={isLoading}
              onClick={onSubmit}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          </div>
        </div>
      </div>

      {/* Spacer to prevent content from being hidden behind the bar */}
      {isDirty && <div className="h-20" />}
    </>
  )
}
