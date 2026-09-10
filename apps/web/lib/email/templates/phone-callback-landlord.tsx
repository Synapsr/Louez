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

interface PhoneCallbackLandlordEmailProps {
  storeName: string;
  primaryColor?: string;
  callerPhone: string;
  message: string;
  conversationUrl: string;
  locale?: EmailLocale;
}

/**
 * Sent to the store owner when the AI voice agent could not complete a caller's
 * request (a booking that couldn't be made, phone bookings off, or a human
 * wanted). It carries the message the agent took and a link back to the call
 * conversation so the owner can read it and replay the recording.
 */
export function PhoneCallbackLandlordEmail({
  storeName,
  primaryColor,
  callerPhone,
  message,
  conversationUrl,
  locale = "fr",
}: PhoneCallbackLandlordEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.phoneCallbackLandlord;

  return (
    <BaseLayout
      preview={messages.subject.replace("{store}", storeName)}
      storeName="Louez.io"
      logoUrl={null}
      primaryColor={primaryColor}
      locale={locale}
    >
      <EmailHeading>{messages.title}</EmailHeading>

      <EmailText>{messages.body.replace("{storeName}", storeName)}</EmailText>

      <Section style={styles.card}>
        <DetailRow label={stripLabelColon(messages.phone)} value={callerPhone} />
        <Text style={{ ...styles.label, margin: "12px 0 4px 0" }}>
          {stripLabelColon(messages.message)}
        </Text>
        <Text style={messageText}>{message}</Text>
      </Section>

      <CtaButton href={conversationUrl} label={messages.listen} primaryColor={primaryColor} />

      <FooterNote>{messages.footer}</FooterNote>
    </BaseLayout>
  );
}

const messageText = {
  ...styles.paragraph,
  margin: "0",
  whiteSpace: "pre-wrap" as const,
};

export default PhoneCallbackLandlordEmail;
