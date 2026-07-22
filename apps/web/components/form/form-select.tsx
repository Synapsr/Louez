'use client'

import type { ReactNode } from 'react'

import { useFieldContext, getFieldError } from '@/hooks/form/form-context'
import {
  Label,
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'

export function FormSelect({
  label,
  description,
  placeholder,
  children,
  className,
  renderValue,
}: {
  label?: string
  description?: string
  placeholder?: string
  children: React.ReactNode
  className?: string
  /**
   * Render the selected value in the trigger. Use when the value differs from
   * what should be shown (e.g. a locale code vs. its flag + name) — otherwise
   * the trigger shows the raw value.
   */
  renderValue?: (value: string) => ReactNode
}) {
  const field = useFieldContext<string>()
  const errors = field.state.meta.errors

  return (
    <div className="grid gap-2">
      {label && (
        <Label htmlFor={field.name} data-error={errors.length > 0}>
          {label}
        </Label>
      )}
      <Select
        onValueChange={(value) => {
          if (value !== null) field.handleChange(value)
        }}
        value={field.state.value || undefined}
      >
        <SelectTrigger className={className}>
          {renderValue ? (
            <SelectValue placeholder={placeholder}>
              {(value) =>
                typeof value === 'string' && value ? renderValue(value) : null
              }
            </SelectValue>
          ) : (
            <SelectValue placeholder={placeholder} />
          )}
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
      {description && (
        <p className="text-muted-foreground text-sm">{description}</p>
      )}
      {errors.length > 0 && (
        <p className="text-destructive text-sm">
          {getFieldError(errors[0])}
        </p>
      )}
    </div>
  )
}
