import nodemailer from 'nodemailer'

import { env } from './env'
import type { SendEmailOptions } from './types'

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return String(value).toLowerCase() === 'true'
}

function toPort(value: unknown): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 587
}

const smtpPort = toPort(env.SMTP_PORT)
const smtpSecure = toBoolean(env.SMTP_SECURE)

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASSWORD,
  },
})

export async function sendEmail({
  to,
  subject,
  html,
  attachments,
}: SendEmailOptions) {
  if (process.env.NODE_ENV === 'development') {
    console.log('[DEV] Email to:', to)
    console.log('[DEV] Subject:', subject)
    console.log('[DEV] HTML:', html)
    if (attachments?.length) {
      console.log('[DEV] Attachments:', attachments.map((a) => a.filename))
    }
    return { messageId: 'dev-' + Date.now(), success: true }
  }

  const result = await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    html,
    attachments,
  })

  return {
    messageId: result.messageId,
    success: true,
  }
}
