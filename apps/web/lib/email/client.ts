import {
  isEmailConfigured,
  sendEmail as transportSendEmail,
} from '@louez/email';
import type { SendEmailOptions } from '@louez/email';

import { throwIfEffectAborted } from '@/lib/api/effect-signal';
import { redactLogText } from '@/lib/evlog';
import { markTestReservationEmail } from '@/lib/test-reservations/email-mark';

/**
 * App-level transactional email refuses to pretend: without a transport the
 * senders' existing failure paths run (emailLogs records 'failed',
 * notification dispatchers record the channel error) instead of logging a
 * delivery that never happened. Auth flows use @louez/email directly and
 * keep its graceful console skip.
 */
/**
 * Whether the request is a demo store's (lib/demo/demo-request.ts). Loaded on
 * call: that module reads the request and the database, which this one does
 * not need outside a request.
 */
const isInDemoStoreRequest = (): Promise<boolean> =>
  import('@/lib/demo/demo-request')
    .then((module) => module.isInDemoRequest())
    .catch(() => false);

export const sendEmail = async (options: SendEmailOptions) => {
  // A demo store's dashboard or storefront (lib/demo) sends no e-mail: it says
  // it did, so the visitor's flow carries on, and nothing leaves.
  if (await isInDemoStoreRequest()) {
    console.log('[email] demo store: an e-mail was not sent');
    return { messageId: `email-demo-${Date.now()}`, success: true };
  }
  if (!isEmailConfigured()) {
    // Neither the recipient nor the subject: both can name a customer.
    console.log('[email] SMTP not configured: an e-mail was not sent');
    throw new Error('EMAIL_NOT_CONFIGURED');
  }
  // An outbox sender may have timed out while the email was prepared (logo,
  // rendering); SMTP cannot be aborted once started, so check last.
  throwIfEffectAborted();
  // A test reservation's e-mail says so in its subject and body
  // (lib/test-reservations). In development, the link the transport prints
  // goes through the logger's redaction (a partner space's secret).
  return transportSendEmail({ ...markTestReservationEmail(options), redactLog: redactLogText });
};

export type { EmailAttachment, SendEmailOptions } from '@louez/email';
