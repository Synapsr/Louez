'use client'

import { log } from 'evlog/next/client'

import { useFormContext } from '@/hooks/form/form-context'

type FormValidationErrors = {
  formName: string
  fieldErrors: Record<string, string[]>
  formErrors: string[]
}

type FormFormProps = React.ComponentProps<'form'> & {
  formName?: string
}

function normalizeErrorMessages(error: unknown): string[] {
  if (Array.isArray(error)) {
    return error.flatMap(normalizeErrorMessages)
  }

  if (error instanceof Error) {
    return [error.message]
  }

  if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof error.message === 'string') {
      return [error.message]
    }

    if ('fields' in error || 'form' in error) {
      return [
        ...normalizeErrorMessages(
          (error as { fields?: unknown }).fields,
        ),
        ...normalizeErrorMessages((error as { form?: unknown }).form),
      ]
    }

    return Object.values(error).flatMap(normalizeErrorMessages)
  }

  if (typeof error === 'string') {
    return [error]
  }

  if (error) {
    return [String(error)]
  }

  return []
}

function getFormValidationErrors(form: ReturnType<typeof useFormContext>) {
  const { fieldMeta, errorMap } = form.state
  const fieldErrors: Record<string, string[]> = {}

  for (const [name, meta] of Object.entries(
    fieldMeta as Record<string, { errorMap?: Record<string, unknown> } | undefined>,
  )) {
    const errors = meta?.errorMap
    if (!errors) continue
    const messages = Object.values(errors).flatMap(normalizeErrorMessages)

    if (messages.length > 0) {
      fieldErrors[name] = messages
    }
  }

  const formErrors = normalizeErrorMessages(
    (errorMap as Record<string, unknown> | undefined)?.onSubmit,
  )
  const hasErrors =
    Object.keys(fieldErrors).length > 0 || formErrors.length > 0

  return hasErrors ? { fieldErrors, formErrors } : null
}

export function FormForm({
  children,
  formName,
  ...props
}: FormFormProps) {
  const form = useFormContext()
  const resolvedFormName =
    formName || props.name || props.id || props['aria-label'] || 'unknown'

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        e.stopPropagation()
        await form.handleSubmit()

        const errors = getFormValidationErrors(form)
        if (errors) {
          log.warn({
            action: 'form_validation_failed',
            form: {
              formName: resolvedFormName,
              fieldNames: Object.keys(errors.fieldErrors),
              fieldErrors: errors.fieldErrors,
              formErrors: errors.formErrors,
            } satisfies FormValidationErrors & { fieldNames: string[] },
          })
        }
      }}
      {...props}
    >
      {children}
    </form>
  )
}
