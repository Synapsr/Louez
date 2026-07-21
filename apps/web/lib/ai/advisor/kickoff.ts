import { VERIFICATION_KICKOFF_PROMPT } from '@louez/validations'

export { VERIFICATION_KICKOFF_PROMPT }

/**
 * Whether a chat message is the hidden verification kickoff — a user turn whose
 * text is exactly the sentinel. Used to filter it out of customer/merchant
 * transcripts and to decide whether a conversation's verification has already
 * been kicked off (prior *browsing* turns must not count).
 */
export function isVerificationKickoff(message: {
  role: string
  parts?: Array<{ type: string; text?: string }>
}): boolean {
  if (message.role !== 'user') return false
  const text = (message.parts ?? [])
    .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
    .join('\n')
  return text === VERIFICATION_KICKOFF_PROMPT
}
