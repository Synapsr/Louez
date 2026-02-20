type FailureActivityType = 'payment_failed' | 'deposit_failed'

interface FormatFailureDescriptionParams {
  activityType: string
  description: string | null
  metadata: Record<string, unknown> | null
  t: (key: string, values?: Record<string, string | number>) => string
}

export interface FormattedActivityDescription {
  message: string
  technicalMessage?: string
}

const ERROR_KIND_BY_CODE: Record<string, string> = {
  authentication_required: 'authenticationRequired',
  card_declined: 'cardDeclined',
  insufficient_funds: 'insufficientFunds',
  expired_card: 'expiredCard',
  incorrect_cvc: 'incorrectCvc',
  processing_error: 'processingError',
  do_not_honor: 'doNotHonor',
}

const ERROR_PATTERNS: Array<{ pattern: RegExp; kind: string }> = [
  {
    pattern: /failed authentication|authentication required|3d[\s-]?secure|requires_action/i,
    kind: 'authenticationRequired',
  },
  {
    pattern: /insufficient funds/i,
    kind: 'insufficientFunds',
  },
  {
    pattern: /expired card/i,
    kind: 'expiredCard',
  },
  {
    pattern: /incorrect cvc|invalid cvc|cvc check failed/i,
    kind: 'incorrectCvc',
  },
  {
    pattern: /do not honor/i,
    kind: 'doNotHonor',
  },
  {
    pattern: /processing error|temporary issue|network error/i,
    kind: 'processingError',
  },
  {
    pattern: /card declined|declined/i,
    kind: 'cardDeclined',
  },
]

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function getRawErrorMessage(
  description: string | null,
  metadata: Record<string, unknown> | null
): string | undefined {
  return (
    asString(metadata?.error) ??
    asString(metadata?.stripeErrorMessage) ??
    asString(description)
  )
}

function getStripeErrorCode(metadata: Record<string, unknown> | null): string | undefined {
  const code =
    asString(metadata?.errorCode) ??
    asString(metadata?.stripeErrorCode) ??
    asString(metadata?.declineCode) ??
    asString(metadata?.stripeDeclineCode)

  return code?.toLowerCase()
}

function looksLikeStripeTechnicalError(rawErrorMessage: string | undefined): boolean {
  if (!rawErrorMessage) return false

  return /(paymentintent|paymentmethod|stripe|authentication|3d[\s-]?secure|declined|cvc|card)/i.test(
    rawErrorMessage
  )
}

function resolveErrorKind(
  code: string | undefined,
  rawErrorMessage: string | undefined
): string | undefined {
  if (code && ERROR_KIND_BY_CODE[code]) {
    return ERROR_KIND_BY_CODE[code]
  }

  if (!rawErrorMessage) {
    return undefined
  }

  const patternMatch = ERROR_PATTERNS.find(({ pattern }) => pattern.test(rawErrorMessage))
  return patternMatch?.kind
}

export function formatPaymentFailureDescription({
  activityType,
  description,
  metadata,
  t,
}: FormatFailureDescriptionParams): FormattedActivityDescription | null {
  if (!description) return null

  if (activityType !== 'payment_failed' && activityType !== 'deposit_failed') {
    return { message: description }
  }

  const failureType = activityType as FailureActivityType
  const rawErrorMessage = getRawErrorMessage(description, metadata)
  const errorCode = getStripeErrorCode(metadata)
  const errorKind = resolveErrorKind(errorCode, rawErrorMessage)

  const hasStripeSignal =
    asString(metadata?.paymentIntentId) !== undefined ||
    asString(metadata?.method) === 'stripe' ||
    looksLikeStripeTechnicalError(rawErrorMessage)

  if (!hasStripeSignal || !rawErrorMessage) {
    return { message: description }
  }

  if (!errorKind) {
    return {
      message: t(`activity.paymentFailure.${failureType}.generic`),
      technicalMessage: rawErrorMessage,
    }
  }

  return {
    message: t(`activity.paymentFailure.${failureType}.${errorKind}`),
    technicalMessage: rawErrorMessage,
  }
}
