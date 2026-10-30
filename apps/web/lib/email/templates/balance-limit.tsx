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

export type BalanceLimitVariant = "near" | "reached";

interface BalanceLimitEmailProps {
  variant: BalanceLimitVariant;
  storeName: string;
  primaryColor?: string;
  /** The unpaid balance, already formatted in the store's currency. */
  balance: string;
  /** The limit, already formatted; null when the service gave none. */
  limit: string | null;
  ctaUrl: string;
  locale?: EmailLocale;
}

/**
 * Store-owner notice that the store's unpaid balance with Louez is near its limit
 * (near) or has reached it, which pauses new reservations (reached). The billing
 * service sets the limit and the amounts (louez-billing docs/api, README §8.8); Louez
 * sends this once each time a store crosses into either state.
 */
export function BalanceLimitEmail({
  variant,
  storeName,
  primaryColor,
  balance,
  limit,
  ctaUrl,
  locale = "fr",
}: BalanceLimitEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.balanceLimit;
  const variantMessages = messages[variant];

  return (
    <BaseLayout
      preview={variantMessages.subject.replace("{storeName}", storeName)}
      storeName="Louez.io"
      logoUrl={null}
      primaryColor={primaryColor}
      locale={locale}
    >
      <EmailHeading>{variantMessages.title}</EmailHeading>

      <EmailText>{variantMessages.body.replace("{storeName}", storeName)}</EmailText>

      <Section style={styles.card}>
        <DetailRow label={stripLabelColon(messages.balanceLabel)} value={balance} />
        {limit && <DetailRow label={stripLabelColon(messages.limitLabel)} value={limit} />}
      </Section>

      <CtaButton href={ctaUrl} label={messages.cta} primaryColor={primaryColor} />

      <FooterNote>{messages.footer}</FooterNote>
    </BaseLayout>
  );
}

export default BalanceLimitEmail;
