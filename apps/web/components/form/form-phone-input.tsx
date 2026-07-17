'use client';

import { Label } from '@louez/ui';

import { PhoneInput, type PhoneInputProps } from '@/components/ui/phone-input';

import { getFieldError, useFieldContext } from '@/hooks/form/form-context';

interface FormPhoneInputProps extends Omit<
  PhoneInputProps,
  'value' | 'onChange'
> {
  label?: string;
  description?: string;
}

export const FormPhoneInput = ({
  label,
  description,
  ...props
}: FormPhoneInputProps) => {
  const field = useFieldContext<string>();
  const errors = field.state.meta.errors;
  const error = errors[0];
  const errorId = `${field.name}-error`;

  return (
    <div className="min-w-0 space-y-2">
      {label && (
        <Label htmlFor={field.name} data-error={errors.length > 0}>
          {label}
        </Label>
      )}
      <PhoneInput
        id={field.name}
        name={field.name}
        value={field.state.value}
        onChange={field.handleChange}
        onBlur={field.handleBlur}
        aria-invalid={errors.length > 0}
        aria-describedby={error ? errorId : undefined}
        {...props}
      />
      {description && (
        <p className="text-muted-foreground text-sm">{description}</p>
      )}
      {error && (
        <p id={errorId} className="text-destructive text-sm">
          {getFieldError(error)}
        </p>
      )}
    </div>
  );
};
