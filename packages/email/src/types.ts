export type EmailLocale = 'fr' | 'en' | 'de' | 'es' | 'it' | 'nl' | 'pl' | 'pt'

export interface EmailAttachment {
  filename: string
  content: Buffer
  cid: string
}

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  attachments?: EmailAttachment[]
}
