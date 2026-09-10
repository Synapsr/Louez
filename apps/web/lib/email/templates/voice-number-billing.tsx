import { Section } from "@react-email/components";
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
  primaryColor,
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

  return (
    <BaseLayout
      preview={variantMessages.subject.replace("{number}", e164)}
      storeName="Louez.io"
      logoUrl={null}
      primaryColor={primaryColor}
      locale={locale}
    >
      <EmailHeading>{variantMessages.title}</EmailHeading>

      <EmailText>{body}</EmailText>

      <Section style={styles.card}>
        <DetailRow label={stripLabelColon(messages.numberLabel)} value={e164} />
        <DetailRow
          label={stripLabelColon(messages.rentalLabel)}
          value={messages.rentalValue.replace("{credits}", String(credits))}
        />
        {deadlineText && variant !== "released" && (
          <DetailRow label={stripLabelColon(messages.deadlineLabel)} value={deadlineText} />
        )}
      </Section>

      <CtaButton
        href={ctaUrl}
        label={variant === "released" ? messages.ctaOpen : messages.ctaRecharge}
        primaryColor={primaryColor}
      />

      <FooterNote>{messages.footer}</FooterNote>
    </BaseLayout>
  );
}

export default VoiceNumberBillingEmail;
