import {
  isEmailConfigured,
  sendEmail as transportSendEmail,
} from '@louez/email';
import type { SendEmailOptions } from '@louez/email';

import { throwIfEffectAborted } from '@/lib/api/effect-signal';
import { markTestReservationEmail } from '@/lib/test-reservations/email-mark';

/**
 * App-level transactional email refuses to pretend: without a transport the
 * senders' existing failure paths run (emailLogs records 'failed',
 * notification dispatchers record the channel error) instead of logging a
 * delivery that never happened. Auth flows use @louez/email directly and
 * keep its graceful console skip.
 */
export const sendEmail = async (options: SendEmailOptions) => {
  if (!isEmailConfigured()) {
    // Neither the recipient nor the subject: both can name a customer.
    console.log('[email] SMTP not configured: an e-mail was not sent');
    throw new Error('EMAIL_NOT_CONFIGURED');
  }
  // An outbox sender may have timed out while the email was prepared (logo,
  // rendering); SMTP cannot be aborted once started, so check last.
  throwIfEffectAborted();
  // A test reservation's e-mail says so in its subject and body (lib/test-reservations).
  return transportSendEmail(markTestReservationEmail(options));
};

export type { EmailAttachment, SendEmailOptions } from '@louez/email';
