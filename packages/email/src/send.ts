import nodemailer from 'nodemailer';

import { env } from './env';
import type { SendEmailOptions } from './types';

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function toPort(value: unknown): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 587;
}

const smtpPort = toPort(env.SMTP_PORT);
const smtpSecure = toBoolean(env.SMTP_SECURE);

// Dev-only delivery guard: in development, email is only sent to recipients on
// DEV_EMAIL_ALLOWLIST so real customers are never contacted from a dev machine.
// Entries are comma-separated and may be full addresses (you@example.com) or
// domain suffixes (@example.com). Empty/unset blocks all dev sends.
const devRecipientAllowlist = (env.DEV_EMAIL_ALLOWLIST ?? '')
  .split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

function isAllowedDevRecipient(email: string) {
  const to = email.trim().toLowerCase();
  return devRecipientAllowlist.some((entry) =>
    entry.startsWith('@') ? to.endsWith(entry) : to === entry,
  );
}

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASSWORD,
  },
});

export async function sendEmail({
  to,
  subject,
  html,
  attachments,
  fromName,
}: SendEmailOptions) {
  // Build from address: use store name if provided, otherwise use SMTP_FROM as-is
  let from = env.SMTP_FROM;
  if (fromName) {
    // Extract email address from SMTP_FROM (e.g. "Louez.io <noreply@lumy.agency>" → "noreply@lumy.agency")
    const emailMatch = env.SMTP_FROM.match(/<(.+)>/);
    const emailAddress = emailMatch ? emailMatch[1] : env.SMTP_FROM;
    from = `"${fromName.replace(/"/g, '')}" <${emailAddress}>`;
  }

  // Fail-closed: anything that is not explicitly production keeps the dev allowlist guard
  // ON. Reads process.env directly because env.NODE_ENV's .default('development') is skipped
  // under SKIP_ENV_VALIDATION (an unset NODE_ENV must not silently send to all recipients).
  if (process.env.NODE_ENV !== 'production') {
    console.log('[DEV] Email from:', from);
    console.log('[DEV] Email to:', to);
    console.log('[DEV] Subject:', subject);

    if (!isAllowedDevRecipient(to)) {
      console.log('[DEV] Email skipped: recipient not in DEV_EMAIL_ALLOWLIST');

      return { messageId: `dev-skipped-${Date.now()}`, success: true };
    }
  }

  const result = await transporter.sendMail({
    from,
    to,
    subject,
    html,
    attachments,
  });

  return {
    messageId: result.messageId,
    success: true,
  };
}
