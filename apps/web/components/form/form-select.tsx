'use client'

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
  items,
}: {
  label?: string
  description?: string
  placeholder?: string
  children: React.ReactNode
  className?: string
  /** Maps values to display labels in the trigger (Base UI `Select.Root` items). */
  items?:
    | Record<string, React.ReactNode>
    | ReadonlyArray<{ value: string; label: React.ReactNode }>
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
        items={items}
        onValueChange={(value) => {
          if (value !== null) field.handleChange(value)
        }}
        value={field.state.value || null}
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
          {getFieldError(errors[0])}
        </p>
      )}
    </div>
  )
}
