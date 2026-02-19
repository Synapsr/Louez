import { createFormHookContexts } from '@tanstack/react-form'

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts()

/** Safely extract a displayable string from a TanStack Form field error. */
export function getFieldError(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}
