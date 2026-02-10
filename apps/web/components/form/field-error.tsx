'use client'

import type { AnyFieldApi } from '@tanstack/react-form'

export function FieldError({ field }: { field: AnyFieldApi }) {
  const errors = field.state.meta.errors
  if (!errors.length) return null

  return (
    <p className="text-destructive text-sm">
      {typeof errors[0] === 'string' ? errors[0] : String(errors[0])}
    </p>
  )
}
