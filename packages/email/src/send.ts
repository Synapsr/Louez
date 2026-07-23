import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

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

function readSmtpSetting(value: string | undefined): string {
  // Compose files and some hosts inject empty strings for unset variables;
  // treat those as "not configured" rather than as real values.
  return (value ?? '').trim();
}

/**
 * Whether an outgoing email transport is configured on this instance.
 *
 * Every email — auth OTP/magic links, reservation notifications, invites —
 * funnels through sendEmail below, so this single check is the source of
 * truth for "can this instance send email at all". Mirrors the
 * isSmsConfigured / isPushConfigured convention in the web app.
 */
export function isEmailConfigured(): boolean {
  return Boolean(
    readSmtpSetting(env.SMTP_HOST) &&
      readSmtpSetting(env.SMTP_USER) &&
      readSmtpSetting(env.SMTP_PASSWORD) &&
      readSmtpSetting(env.SMTP_FROM),
  );
}

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

// Created lazily so importing this module never requires SMTP settings —
// instances without an email provider must still boot and run.
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: readSmtpSetting(env.SMTP_HOST),
    port: toPort(env.SMTP_PORT),
    secure: toBoolean(env.SMTP_SECURE),
    auth: {
      user: readSmtpSetting(env.SMTP_USER),
      pass: readSmtpSetting(env.SMTP_PASSWORD),
    },
  });
  return transporter;
}

export async function sendEmail({
  to,
  subject,
  html,
  attachments,
  fromName,
}: SendEmailOptions) {
  // No transport configured: log-and-skip with a synthetic success so callers
  // (auth flows, notification dispatchers) degrade instead of throwing.
  // Blocking flows should pre-check isEmailConfigured() to show an honest UI.
  if (!isEmailConfigured()) {
    console.log(`[email] SMTP not configured — skipped "${subject}" to ${to}`);
    return { messageId: `email-disabled-${Date.now()}`, success: true };
  }

  const smtpFrom = readSmtpSetting(env.SMTP_FROM);

  // Build from address: use store name if provided, otherwise use SMTP_FROM as-is
  let from = smtpFrom;
  if (fromName) {
    // Extract email address from SMTP_FROM (e.g. "Louez.io <noreply@lumy.agency>" → "noreply@lumy.agency")
    const emailMatch = smtpFrom.match(/<(.+)>/);
    const emailAddress = emailMatch ? emailMatch[1] : smtpFrom;
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

  const result = await getTransporter().sendMail({
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
