'use client'

import { useFieldContext } from '@/hooks/form/form-context'
import { Checkbox, Label } from '@louez/ui'

export function FormCheckbox({
  label,
  description,
  className,
}: {
  label?: string
  description?: string
  className?: string
}) {
  const field = useFieldContext<boolean>()
  const errors = field.state.meta.errors

  return (
    <div className={className ?? 'flex flex-row items-center space-x-2'}>
      <Checkbox
        id={field.name}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked as boolean)}
      />
      <div className="space-y-1 leading-none">
        {label && (
          <Label htmlFor={field.name} className="text-sm font-normal cursor-pointer">
            {label}
          </Label>
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
    </div>
  )
}
