import { Section } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import { CtaButton, EmailHeading, EmailText, FooterNote, styles } from "./components";
import { getEmailTranslations, type EmailLocale } from "../i18n";

interface RewardUnlockedEmailProps {
  storeName: string;
  storeLogoUrl?: string | null;
  primaryColor?: string;
  referredStoreName: string;
  kind: "free_reservations" | "invoice_credit";
  freeReservations: number;
  rewardValue: string;
  ctaUrl: string;
  locale?: EmailLocale;
}

export function RewardUnlockedEmail({
  storeName,
  storeLogoUrl,
  primaryColor,
  referredStoreName,
  kind,
  freeReservations,
  rewardValue,
  ctaUrl,
  locale = "fr",
}: RewardUnlockedEmailProps) {
  const messages = getEmailTranslations(locale).rewardUnlocked;

  // A subscribed referrer earns a euro invoice credit (no free reservations); use the
  // credit-specific copy so the email is not misleading.
  const template = kind === "invoice_credit" ? messages.bodyCredit : messages.body;
  const body = template
    .replace("{referredStoreName}", referredStoreName)
    .replace("{freeReservations}", String(freeReservations))
    .replace("{rewardValue}", rewardValue);

  return (
    <BaseLayout
      preview={kind === "invoice_credit" ? messages.subjectCredit : messages.subject}
      storeName={storeName}
      logoUrl={storeLogoUrl}
      primaryColor={primaryColor}
      locale={locale}
    >
      <EmailHeading>{messages.title}</EmailHeading>

      <EmailText>{messages.greeting}</EmailText>

      <Section style={styles.card}>
        <EmailText bold style={{ margin: "0" }}>
          {body}
        </EmailText>
      </Section>

      <CtaButton href={ctaUrl} label={messages.cta} primaryColor={primaryColor} />

      <FooterNote>{messages.footer}</FooterNote>
    </BaseLayout>
  );
}

export default RewardUnlockedEmail;
