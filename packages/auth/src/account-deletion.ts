import { z } from 'zod'

export const ACCOUNT_DELETION_REASON_HEADER = 'x-louez-account-deletion-reason'

export const accountDeletionReasons = [
  'too_expensive',
  'missing_features',
  'difficult_to_use',
  'no_longer_needed',
  'switched_service',
  'technical_issues',
  'privacy_concerns',
  'other',
] as const

export const accountDeletionReasonSchema = z.enum(accountDeletionReasons)

export type AccountDeletionReason = z.infer<typeof accountDeletionReasonSchema>

export const parseAccountDeletionReason = (
  value: string | null | undefined,
): AccountDeletionReason | null => {
  const result = accountDeletionReasonSchema.safeParse(value)
  return result.success ? result.data : null
}

export const getAccountDeletionReasonFromRequest = (
  request?: Request,
): AccountDeletionReason | null =>
  parseAccountDeletionReason(request?.headers.get(ACCOUNT_DELETION_REASON_HEADER))

export const buildAccountDeletionConfirmationFragment = (
  token: string,
  reason: AccountDeletionReason | null,
): string => {
  const fragment = new URLSearchParams({ token })
  if (reason) fragment.set('reason', reason)
  return fragment.toString()
}
