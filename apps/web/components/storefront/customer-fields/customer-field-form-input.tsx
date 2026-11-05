"use client";

import { getFieldError, useFieldContext } from "@/hooks/form/form-context";

import { CustomerFieldInput } from "./customer-field-input";
import type { StorefrontCustomerField } from "./customer-fields.types";

interface CustomerFieldFormInputProps {
  field: StorefrontCustomerField;
}

/**
 * A custom field bound to the `form.AppField` it is rendered in, whatever the
 * form. Errors show once the field is touched (a step's "Continuer" or a
 * submit touches it), so a step never opens already red. A refusal from the
 * server (`errorMap.onServer`) goes away as soon as the value changes.
 */
export const CustomerFieldFormInput = ({ field }: CustomerFieldFormInputProps) => {
  const formField = useFieldContext<string | undefined>();
  const { isTouched, errors, errorMap } = formField.state.meta;
  const error = isTouched && errors.length > 0 ? getFieldError(errors[0]) : undefined;

  const handleChange = (value: string) => {
    formField.handleChange(value);
    if (errorMap.onServer !== undefined) {
      formField.setMeta((prev) => ({
        ...prev,
        errorMap: { ...prev.errorMap, onServer: undefined },
      }));
    }
  };

  return (
    <CustomerFieldInput
      field={field}
      id={formField.name}
      value={formField.state.value ?? ""}
      onChange={handleChange}
      onBlur={formField.handleBlur}
      error={error}
    />
  );
};
