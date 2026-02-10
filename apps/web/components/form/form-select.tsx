'use client'

import { useFieldContext } from '@/hooks/form/form-context'
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
}: {
  label?: string
  description?: string
  placeholder?: string
  children: React.ReactNode
  className?: string
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
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
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
