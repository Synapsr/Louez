import {
  isEmailConfigured,
  sendEmail as transportSendEmail,
} from '@louez/email';
import type { SendEmailOptions } from '@louez/email';

import { throwIfEffectAborted } from '@/lib/api/effect-signal';

/**
 * App-level transactional email refuses to pretend: without a transport the
 * senders' existing failure paths run (emailLogs records 'failed',
 * notification dispatchers record the channel error) instead of logging a
 * delivery that never happened. Auth flows use @louez/email directly and
 * keep its graceful console skip.
 */
export const sendEmail = async (options: SendEmailOptions) => {
  if (!isEmailConfigured()) {
    console.log(
      `[email] SMTP not configured — "${options.subject}" to ${options.to} not sent`,
    );
    throw new Error('EMAIL_NOT_CONFIGURED');
  }
  // An outbox sender may have timed out while the email was prepared (logo,
  // rendering); SMTP cannot be aborted once started, so check last.
  throwIfEffectAborted();
  return transportSendEmail(options);
};

export type { EmailAttachment, SendEmailOptions } from '@louez/email';
