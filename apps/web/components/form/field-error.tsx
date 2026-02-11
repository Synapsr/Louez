'use client'

import type { AnyFieldApi } from '@tanstack/react-form'

import { getFieldError } from '@/hooks/form/form-context'

export function FieldError({ field }: { field: AnyFieldApi }) {
  const errors = field.state.meta.errors
  if (!errors.length) return null

  return (
    <p className="text-destructive text-sm">
      {getFieldError(errors[0])}
    </p>
  )
}
