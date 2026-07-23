import { Button, Heading, Section, Text } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import { getContrastColorHex } from "@/lib/utils/colors";
import { getEmailTranslations, type EmailLocale } from "../i18n";

export type VoiceNumberBillingVariant = "warning" | "failed" | "released";

interface VoiceNumberBillingEmailProps {
  variant: VoiceNumberBillingVariant;
  storeName: string;
  primaryColor?: string;
  e164: string;
  /** Monthly rental in AI credits. */
  credits: number;
  /** Localized renewal/release deadline, already formatted for display. */
  deadlineText?: string | null;
  ctaUrl: string;
  locale?: EmailLocale;
}

/**
 * Store-owner notice about the AI phone number's monthly rental (paid in AI
 * credits): upcoming renewal the balance can't cover (warning), failed renewal
 * with the release deadline (failed), or the number having been detached
 * (released). One template, three variants — same layout, per-variant copy.
 */
export function VoiceNumberBillingEmail({
  variant,
  storeName,
  primaryColor = "#0066FF",
  e164,
  credits,
  deadlineText,
  ctaUrl,
  locale = "fr",
}: VoiceNumberBillingEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.voiceNumberBilling;
  const variantMessages = messages[variant];

  const body = variantMessages.body
    .replace("{storeName}", storeName)
    .replace("{number}", e164)
    .replace("{credits}", String(credits))
    .replace("{date}", deadlineText ?? "");

  const buttonStyle = {
    ...button,
    backgroundColor: primaryColor,
    color: getContrastColorHex(primaryColor),
  };

  return (
    <BaseLayout
      preview={variantMessages.subject.replace("{number}", e164)}
      storeName="Louez.io"
      logoUrl={null}
      primaryColor={primaryColor}
      locale={locale}
    >
      <Heading style={heading}>{variantMessages.title}</Heading>

      <Text style={paragraph}>{body}</Text>

      <Section style={infoBox}>
        <Text style={infoRow}>
          <strong>{messages.numberLabel}</strong> {e164}
        </Text>
        <Text style={infoRow}>
          <strong>{messages.rentalLabel}</strong>{" "}
          {messages.rentalValue.replace("{credits}", String(credits))}
        </Text>
        {deadlineText && variant !== "released" && (
          <Text style={infoRow}>
            <strong>{messages.deadlineLabel}</strong> {deadlineText}
          </Text>
        )}
      </Section>

      <Section style={ctaSection}>
        <Button href={ctaUrl} style={buttonStyle}>
          {variant === "released" ? messages.ctaOpen : messages.ctaRecharge}
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

export default VoiceNumberBillingEmail;
