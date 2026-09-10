import { Section } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import {
  CtaButton,
  DetailRow,
  EmailHeading,
  EmailText,
  FooterNote,
  InfoCard,
  stripLabelColon,
  styles,
} from "./components";
import {
  getEmailTranslations,
  getDateFormatPatterns,
  getCurrencyFormatter,
  type EmailLocale,
} from "../i18n";
import { formatEmailDateInStoreTimezone, getStoreTimezoneLabel } from "../date-time";

interface ReminderReturnAdminEmailProps {
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  storeAddress?: string | null;
  storeEmail?: string | null;
  storePhone?: string | null;
  storeTimezone?: string | null;
  storeCountry?: string | null;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  customerPhone?: string | null;
  reservationNumber: string;
  endDate: Date;
  total: number;
  dashboardUrl: string;
  currency?: string;
  locale?: EmailLocale;
}

export function ReminderReturnAdminEmail({
  storeName,
  logoUrl,
  primaryColor,
  storeAddress,
  storeEmail,
  storePhone,
  storeTimezone,
  storeCountry,
  customerFirstName,
  customerLastName,
  customerEmail,
  customerPhone,
  reservationNumber,
  endDate,
  total,
  dashboardUrl,
  currency = "EUR",
  locale = "fr",
}: ReminderReturnAdminEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.reminderReturnAdmin;
  const datePatterns = getDateFormatPatterns(locale);
  const formatCurrency = getCurrencyFormatter(locale, currency);
  const timezoneLabel = getStoreTimezoneLabel(endDate, storeTimezone, storeCountry);
  const timezoneLine =
    typeof t.common.timezone === "string"
      ? t.common.timezone.replace("{timezone}", timezoneLabel)
      : `Timezone: ${timezoneLabel}`;

  return (
    <BaseLayout
      preview={messages.subject.replace("{number}", reservationNumber)}
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      storeAddress={storeAddress}
      locale={locale}
    >
      <EmailHeading>{messages.title}</EmailHeading>

      <EmailText>{messages.body.replace("{number}", reservationNumber)}</EmailText>

      <InfoCard
        label={stripLabelColon(messages.scheduledReturn)}
        value={formatEmailDateInStoreTimezone(
          endDate,
          locale,
          datePatterns.full,
          storeTimezone,
          storeCountry,
        )}
        footnote={timezoneLine}
      />

      <Section style={styles.card}>
        <DetailRow
          label={stripLabelColon(messages.customer)}
          value={`${customerFirstName} ${customerLastName}`}
        />
        <DetailRow label={stripLabelColon(messages.email)} value={customerEmail} />
        {customerPhone && (
          <DetailRow label={stripLabelColon(messages.phone)} value={customerPhone} />
        )}
        <DetailRow label={stripLabelColon(messages.amount)} value={formatCurrency(total)} />
      </Section>

      <CtaButton href={dashboardUrl} label={messages.viewReservation} primaryColor={primaryColor} />

      <FooterNote>{messages.connectToManage}</FooterNote>
    </BaseLayout>
  );
}

export default ReminderReturnAdminEmail;
