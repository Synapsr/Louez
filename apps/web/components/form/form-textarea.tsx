'use client'

import { useFieldContext, getFieldError } from '@/hooks/form/form-context'
import { Label, Textarea, type TextareaProps } from '@louez/ui'

export function FormTextarea({
  label,
  description,
  ...props
}: { label?: string; description?: string } & TextareaProps) {
  const field = useFieldContext<string>()
  const errors = field.state.meta.errors

  return (
    <div className="grid gap-2">
      {label && (
        <Label htmlFor={field.name} data-error={errors.length > 0}>
          {label}
        </Label>
      )}
      <Textarea
        id={field.name}
        name={field.name}
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={errors.length > 0}
        {...props}
      />
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
