"use client";

import { useFieldContext } from "@/hooks/form/form-context";

import { RentalUnitParticipantField } from "./rental-unit-participant-field";

/** "Pour qui ?" bound to the `form.AppField` it is rendered in, whatever the form. */
export const RentalUnitParticipantInput = () => {
  const field = useFieldContext<string | undefined>();

  return (
    <RentalUnitParticipantField
      id={field.name}
      value={field.state.value ?? ""}
      onChange={field.handleChange}
      onBlur={field.handleBlur}
    />
  );
};
