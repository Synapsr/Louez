import { Section, Text } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import {
  CtaButton,
  DetailRow,
  EmailHeading,
  EmailText,
  FooterNote,
  stripLabelColon,
  styles,
} from "./components";
import { getEmailTranslations, type EmailLocale } from "../i18n";

interface ContactMessageEmailProps {
  storeName: string;
  primaryColor?: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string | null;
  message: string;
  locale?: EmailLocale;
}

/**
 * Sent to the store when a visitor writes through the storefront contact
 * form. Carries who wrote, how to reach them and the message as typed; the
 * reply button opens the store's mail client on the visitor's address, and
 * the email's reply-to points there as well.
 */
export function ContactMessageEmail({
  storeName,
  primaryColor,
  senderName,
  senderEmail,
  senderPhone,
  message,
  locale = "fr",
}: ContactMessageEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.contactMessage;

  return (
    <BaseLayout
      preview={messages.subject.replace("{name}", senderName).replace("{store}", storeName)}
      storeName="Louez.io"
      logoUrl={null}
      primaryColor={primaryColor}
      locale={locale}
    >
      <EmailHeading>{messages.title}</EmailHeading>

      <EmailText>{messages.body.replace("{storeName}", storeName)}</EmailText>

      <Section style={styles.card}>
        <DetailRow label={stripLabelColon(messages.name)} value={senderName} />
        <DetailRow label={stripLabelColon(messages.email)} value={senderEmail} />
        {senderPhone ? (
          <DetailRow label={stripLabelColon(messages.phone)} value={senderPhone} />
        ) : null}
        <Text style={{ ...styles.label, margin: "12px 0 4px 0" }}>
          {stripLabelColon(messages.message)}
        </Text>
        <Text style={messageText}>{message}</Text>
      </Section>

      <CtaButton
        href={`mailto:${senderEmail}`}
        label={messages.reply}
        primaryColor={primaryColor}
      />

      <FooterNote>{messages.footer}</FooterNote>
    </BaseLayout>
  );
}

const messageText = {
  ...styles.paragraph,
  margin: "0",
  whiteSpace: "pre-wrap" as const,
};

export default ContactMessageEmail;
