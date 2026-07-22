import { Button, Heading, Section, Text } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import { getContrastColorHex } from "@/lib/utils/colors";
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
  primaryColor = "#0066FF",
  callerPhone,
  message,
  conversationUrl,
  locale = "fr",
}: PhoneCallbackLandlordEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.phoneCallbackLandlord;

  const buttonStyle = {
    ...button,
    backgroundColor: primaryColor,
    color: getContrastColorHex(primaryColor),
  };

  return (
    <BaseLayout
      preview={messages.subject.replace("{store}", storeName)}
      storeName="Louez.io"
      logoUrl={null}
      primaryColor={primaryColor}
      locale={locale}
    >
      <Heading style={heading}>{messages.title}</Heading>

      <Text style={paragraph}>
        {messages.body.replace("{storeName}", storeName)}
      </Text>

      <Section style={infoBox}>
        <Text style={infoRow}>
          <strong>{messages.phone}</strong> {callerPhone}
        </Text>
        <Text style={infoRow}>
          <strong>{messages.message}</strong> {message}
        </Text>
      </Section>

      <Section style={ctaSection}>
        <Button href={conversationUrl} style={buttonStyle}>
          {messages.listen}
        </Button>
      </Section>

      <Text style={footerNote}>{messages.footer}</Text>
    </BaseLayout>
  );
}

const heading = {
  fontSize: "24px",
  fontWeight: "bold" as const,
  color: "#1a1a1a",
  marginBottom: "24px",
};

const paragraph = {
  fontSize: "14px",
  lineHeight: "24px",
  color: "#525f7f",
  margin: "0 0 16px 0",
};

const infoBox = {
  backgroundColor: "#f4f4f5",
  borderRadius: "8px",
  padding: "20px",
  margin: "24px 0",
};

const infoRow = {
  fontSize: "14px",
  color: "#1a1a1a",
  margin: "0 0 8px 0",
};

const ctaSection = {
  textAlign: "center" as const,
  marginTop: "32px",
  marginBottom: "32px",
};

const button = {
  backgroundColor: "#0066FF",
  borderRadius: "6px",
  color: "#fff",
  fontSize: "14px",
  fontWeight: "bold" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 24px",
};

const footerNote = {
  fontSize: "13px",
  color: "#8898aa",
  textAlign: "center" as const,
};

export default PhoneCallbackLandlordEmail;
