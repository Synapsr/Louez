'use client';

import { REGEXP_ONLY_DIGITS } from 'input-otp';

import { cn } from '@louez/utils';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Label,
} from '@louez/ui';

import { getFieldError, useFieldContext } from '@/hooks/form/form-context';

interface FormOtpProps {
  autoFocus?: boolean;
  className?: string;
  containerClassName?: string;
  description?: string;
  disabled?: boolean;
  label?: string;
  length?: number;
  onComplete?: (value: string) => void;
  slotClassName?: string;
}

export const FormOtp = ({
  autoFocus,
  className,
  containerClassName,
  description,
  disabled,
  label,
  length = 6,
  onComplete,
  slotClassName,
}: FormOtpProps) => {
  const field = useFieldContext<string>();
  const errors = field.state.meta.errors;

  return (
    <div className="space-y-2">
      {label && (
        <Label htmlFor={field.name} data-error={errors.length > 0}>
          {label}
        </Label>
      )}
      <InputOTP
        id={field.name}
        name={field.name}
        maxLength={length}
        pattern={REGEXP_ONLY_DIGITS}
        pasteTransformer={(pastedText) =>
          pastedText.replace(/\D/g, '').slice(0, length)
        }
        value={field.state.value}
        onChange={field.handleChange}
        onComplete={onComplete}
        onBlur={field.handleBlur}
        aria-invalid={errors.length > 0}
        autoFocus={autoFocus}
        disabled={disabled}
        className={className}
        containerClassName={containerClassName}
      >
        <InputOTPGroup>
          {Array.from({ length }, (_, index) => (
            <InputOTPSlot
              key={index}
              index={index}
              className={cn('h-12 w-10 text-lg sm:h-14 sm:w-12', slotClassName)}
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {description && (
        <p className="text-muted-foreground text-sm">{description}</p>
      )}
      {errors.length > 0 && (
        <p className="text-destructive text-sm">
          {getFieldError(errors[0])}
        </p>
      )}
    </div>
  );
};
