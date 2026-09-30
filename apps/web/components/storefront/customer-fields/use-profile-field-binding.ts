"use client";

import { getFieldError, useFieldContext } from "@/hooks/form/form-context";

/**
 * Binds a native field's input to the `form.AppField` it is rendered in,
 * whatever the form (checkout, account profile), with the custom fields'
 * rules: the error shows once the field is touched, and a refusal from the
 * server (`errorMap.onServer`) goes away as soon as the value changes.
 */
export const useProfileFieldBinding = <TValue>() => {
  const formField = useFieldContext<TValue>();
  const { isTouched, errors, errorMap } = formField.state.meta;

  const onChange = (value: TValue) => {
    formField.handleChange(value);
    if (errorMap.onServer !== undefined) {
      formField.setMeta((prev) => ({
        ...prev,
        errorMap: { ...prev.errorMap, onServer: undefined },
      }));
    }
  };

  return {
    id: formField.name,
    value: formField.state.value,
    onChange,
    onBlur: formField.handleBlur,
    error: isTouched && errors.length > 0 ? getFieldError(errors[0]) : undefined,
  };
};
