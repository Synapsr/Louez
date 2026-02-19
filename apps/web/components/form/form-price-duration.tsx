'use client'

import { Label } from '@louez/ui'

import { getFieldError, useFieldContext } from '@/hooks/form/form-context'

import {
  PriceDurationInput,
  type PriceDurationValue,
} from '@/components/ui/price-duration-input'

export function FormPriceDuration({
  label,
  description,
  currency,
  className,
}: {
  label?: string
  description?: string
  currency?: string
  className?: string
}) {
  const field = useFieldContext<PriceDurationValue>()
  const errors = field.state.meta.errors
  const error = errors[0]

  return (
    <div className="space-y-2">
      {label && (
        <Label htmlFor={field.name} data-error={errors.length > 0}>
          {label}
        </Label>
      )}
      <PriceDurationInput
        value={field.state.value}
        onChange={field.handleChange}
        currency={currency}
        className={className}
      />
      {description && (
        <p className="text-muted-foreground text-sm">{description}</p>
      )}
      {error && (
        <p className="text-destructive text-sm">{getFieldError(error)}</p>
      )}
    </div>
  )
}
