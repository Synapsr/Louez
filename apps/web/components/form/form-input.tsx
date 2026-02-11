'use client';

import { Input, type InputProps, Label } from '@louez/ui';

import { useFieldContext, getFieldError } from '@/hooks/form/form-context';

export function FormInput({
  label,
  description,
  suffix,
  className,
  ...props
}: {
  label?: string;
  description?: string;
  suffix?: React.ReactNode;
} & InputProps) {
  const field = useFieldContext<string>();
  const errors = field.state.meta.errors;
  const error = errors[0];

  const inputElement = (
    <Input
      id={field.name}
      name={field.name}
      value={field.state.value}
      onChange={(e) => field.handleChange(e.target.value)}
      onBlur={field.handleBlur}
      aria-invalid={errors.length > 0}
      {...props}
      className={suffix ? `pr-8 ${className ?? ''}`.trim() : className}
    />
  );

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
          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center">
            {suffix}
          </span>
        </div>
      ) : (
        inputElement
      )}
      {description && (
        <p className="text-muted-foreground text-sm">{description}</p>
      )}
      {error && (
        <p className="text-destructive text-sm">
          {getFieldError(error)}
        </p>
      )}
    </div>
  );
}
