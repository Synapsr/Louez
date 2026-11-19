import { Section } from "@react-email/components";

import { BaseLayout } from "./base-layout";
import { CtaButton, EmailHeading, EmailText, FooterNote, styles } from "./components";
import { getEmailTranslator, type EmailLocale } from "../i18n";

/** What a partner's e-mail tells (Liens partenaires), its values already formatted. */
export type PartnerNotification =
  | { kind: "booking"; amount: string; endDate: string }
  | { kind: "payout"; amount: string; month: string }
  | {
      kind: "statement";
      month: string;
      bookings: number;
      due: string;
      paid: string;
      remaining: string;
    };

interface PartnerNotificationEmailProps {
  storeName: string;
  storeLogoUrl?: string | null;
  partnerName: string;
  notification: PartnerNotification;
  spaceUrl: string;
  locale?: EmailLocale;
}

/** The subject of a partner's e-mail. */
export function getPartnerNotificationSubject(
  locale: EmailLocale,
  storeName: string,
  notification: PartnerNotification,
): string {
  const t = getEmailTranslator(locale);
  return t(`partnerNotification.${notification.kind}.subject`, {
    store: storeName,
    ...notification,
  });
}

/**
 * A partner's e-mail: a booking credited to it, a payment the store recorded,
 * or a month's statement; always a link to its space, where it also turns
 * these e-mails off. Nothing about the customer.
 */
export function PartnerNotificationEmail({
  storeName,
  storeLogoUrl,
  partnerName,
  notification,
  spaceUrl,
  locale = "fr",
}: PartnerNotificationEmailProps) {
  const t = getEmailTranslator(locale);
  const key = `partnerNotification.${notification.kind}` as const;
  const values = { store: storeName, partner: partnerName, ...notification };

  return (
    <BaseLayout
      preview={getPartnerNotificationSubject(locale, storeName, notification)}
      storeName={storeName}
      logoUrl={storeLogoUrl}
      locale={locale}
    >
      <EmailHeading>{t(`${key}.title`, values)}</EmailHeading>

      <EmailText>{t("partnerNotification.greeting", values)}</EmailText>

      <Section style={styles.card}>
        <EmailText bold style={{ margin: "0" }}>
          {t(`${key}.body`, values)}
        </EmailText>
      </Section>

      <CtaButton href={spaceUrl} label={t("partnerNotification.cta")} />

      <FooterNote>{t("partnerNotification.footer", values)}</FooterNote>
    </BaseLayout>
  );
}

export default PartnerNotificationEmail;
