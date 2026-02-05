import nodemailer from 'nodemailer'
import { env } from '@/env'

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASSWORD,
  },
})

export interface EmailAttachment {
  filename: string
  content: Buffer
  cid: string
}

interface SendEmailOptions {
  to: string
  subject: string
  html: string
  attachments?: EmailAttachment[]
}

export async function sendEmail({ to, subject, html, attachments }: SendEmailOptions) {
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
