'use client'

import { useFieldContext } from '@/hooks/form/form-context'
import { Input, Label, type InputProps } from '@louez/ui'

export function FormInput({
  label,
  description,
  suffix,
  ...props
}: { label?: string; description?: string; suffix?: React.ReactNode } & InputProps) {
  const field = useFieldContext<string>()
  const errors = field.state.meta.errors

  const inputElement = (
    <Input
      id={field.name}
      name={field.name}
      value={field.state.value}
      onChange={(e) => field.handleChange(e.target.value)}
      onBlur={field.handleBlur}
      aria-invalid={errors.length > 0}
      {...(suffix ? { className: `pr-8 ${props.className ?? ''}`.trim() } : {})}
      {...props}
    />
  )

  return (
    <div className="grid gap-2">
      {label && (
        <Label htmlFor={field.name} data-error={errors.length > 0}>
          {label}
        </Label>
      )}
      {suffix ? (
        <div className="relative">
          {inputElement}
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
            {suffix}
          </span>
        </div>
      ) : (
        inputElement
      )}
      {description && (
        <p className="text-muted-foreground text-sm">{description}</p>
      )}
      {errors.length > 0 && (
        <p className="text-destructive text-sm">
          {typeof errors[0] === 'string' ? errors[0] : String(errors[0])}
        </p>
      )}
    </div>
  )
}
