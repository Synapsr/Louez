/**
 * No e-mail service on this instance: an e-mail an outbox row owes can never
 * go out from it. Its sender gives the row up at once (`abandoned`, its
 * payload kept), and the inbox reads the code before the colon to say why
 * (packages/api services/inbox.ts, `GIVEN_UP_AT_ONCE`).
 */
export const NO_EMAIL = { abandoned: "email_not_configured: no e-mail service is set up" } as const;

/** No SMS provider on this instance: an SMS an outbox row owes can never go out from it. */
export const NO_SMS = { abandoned: "sms_not_configured: no SMS service is set up" } as const;
