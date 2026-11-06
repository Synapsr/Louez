import { render } from "@react-email/render";

import {
  getPasswordChangedEmailSubject,
  isEmailConfigured,
  PasswordChangedEmail,
  sendEmail,
} from "@louez/email";
import type { EmailLocale, PasswordChangedEvent } from "@louez/email";

import { env } from "./env";

/**
 * "This wasn't me" page linked from the notice. Lives under /dashboard because
 * a standalone instance serves every other root path from the storefront.
 */
export const PASSWORD_ALERT_PATH = "/dashboard/account/password-alert";

interface PasswordChangedNotice {
  email: string;
  event: PasswordChangedEvent;
  locale: EmailLocale;
}

/**
 * Tells the account owner that their password was added, changed, reset or
 * removed. Setting a password asks for no e-mail confirmation (the e-mail code
 * already makes the mailbox the root of trust), so this notice is what lets an
 * owner undo a password set from a session they do not control.
 *
 * Never throws: the password operation already happened and must not be
 * reported as failed because the courtesy e-mail could not leave.
 */
export async function sendPasswordChangedNotice({
  email,
  event,
  locale,
}: PasswordChangedNotice): Promise<void> {
  // A standalone instance without SMTP has no mailbox to warn.
  if (!isEmailConfigured()) return;

  try {
    const url = `${env.AUTH_URL}${PASSWORD_ALERT_PATH}`;
    const html = await render(PasswordChangedEmail({ event, url, locale }));
    await sendEmail({
      to: email,
      subject: getPasswordChangedEmailSubject(locale, event),
      html,
      devPreviewUrl: url,
    });
  } catch (error) {
    console.error(`[auth] password ${event} notice could not be sent`, error);
  }
}
