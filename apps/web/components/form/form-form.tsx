'use client'

import { toastManager } from '@louez/ui'

import { useFormContext } from '@/hooks/form/form-context'

function getFormValidationErrors(form: ReturnType<typeof useFormContext>) {
  const { fieldMeta, errorMap } = form.state
  const fieldErrors: Record<string, unknown> = {}

  for (const [name, meta] of Object.entries(
    fieldMeta as Record<string, { errorMap?: Record<string, unknown> } | undefined>,
  )) {
    const errors = meta?.errorMap
    if (!errors) continue
    const hasError = Object.values(errors).some((e) =>
      Array.isArray(e) ? e.length > 0 : !!e,
    )
    if (hasError) {
      fieldErrors[name] = errors
    }
  }

  const formErrors = (errorMap as Record<string, unknown> | undefined)?.onSubmit
  const hasErrors =
    Object.keys(fieldErrors).length > 0 ||
    (Array.isArray(formErrors) ? formErrors.length > 0 : !!formErrors)

  return hasErrors ? { fieldErrors, formErrors } : null
}

export function FormForm({
  children,
  ...props
}: React.ComponentProps<'form'>) {
  const form = useFormContext()

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        e.stopPropagation()
        await form.handleSubmit()

        const errors = getFormValidationErrors(form)
        if (errors) {
          toastManager.add({
            title: 'Please fix the errors before submitting',
            type: 'error',
          })

          if (process.env.NODE_ENV === 'development') {
            console.group('[Form] Validation errors on submit')
            if (Object.keys(errors.fieldErrors).length > 0) {
              console.table(
                Object.fromEntries(
                  Object.entries(errors.fieldErrors).map(([field, errorMap]) => [
                    field,
                    Object.values(errorMap as Record<string, unknown>)
                      .flat()
                      .filter(Boolean)
                      .join(', '),
                  ]),
                ),
              )
            }
            if (errors.formErrors) {
              console.log('Form-level errors:', errors.formErrors)
            }
            console.groupEnd()
          }
        }
      }}
      {...props}
    >
      {children}
    </form>
  )
}
