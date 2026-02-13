'use client';

import { Checkbox, Label } from '@louez/ui';

import { useFieldContext, getFieldError } from '@/hooks/form/form-context';

export function FormCheckbox({
  label,
  description,
  className,
}: {
  label?: string;
  description?: string;
  className?: string;
}) {
  const field = useFieldContext<boolean>();
  const errors = field.state.meta.errors;
  const error = errors[0];

  return (
    <div className={className ?? 'flex flex-row items-center space-x-2'}>
      <Checkbox
        id={field.name}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked as boolean)}
      />
      <div className="space-y-1 leading-none">
        {label && (
          <Label
            htmlFor={field.name}
            className="cursor-pointer text-sm font-normal"
          >
            {label}
          </Label>
        )}
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
        {errors.length > 0 && (
          <p className="text-destructive text-sm">
            {getFieldError(error)}
          </p>
        )}
      </div>
    </div>
  );
}
