import type { SupportedLocale } from "@louez/types";

export type EmailLocale = SupportedLocale;

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  cid: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
  devPreviewUrl?: string;
  fromName?: string;
  /** Address a reply goes to when it is not the sender (e.g. a visitor writing through a contact form). */
  replyTo?: string;
  /**
   * Applied to the e-mail's link before the development log prints it: the
   * app's own log redaction, so a secret link never reaches the console.
   */
  redactLog?: (text: string) => string;
}
