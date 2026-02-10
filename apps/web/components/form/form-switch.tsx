'use client'

import { useFieldContext } from '@/hooks/form/form-context'
import { Label, Switch } from '@louez/ui'

export function FormSwitch({
  label,
  description,
  className,
  disabled,
}: {
  label?: string
  description?: string
  className?: string
  disabled?: boolean
}) {
  const field = useFieldContext<boolean>()

  return (
    <div
      className={
        className ??
        'flex flex-row items-center justify-between rounded-lg border p-4'
      }
    >
      <div className="space-y-0.5">
        {label && (
          <Label htmlFor={field.name} className="text-base">
            {label}
          </Label>
        )}
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      <Switch
        id={field.name}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked)}
        disabled={disabled}
      />
    </div>
  )
}
