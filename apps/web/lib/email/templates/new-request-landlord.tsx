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
import {
  getEmailTranslations,
  getDateFormatPatterns,
  getCurrencyFormatter,
  type EmailLocale,
} from "../i18n";
import { formatEmailDateInStoreTimezone } from "../date-time";

interface NewRequestLandlordEmailProps {
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  reservationNumber: string;
  startDate: Date;
  endDate: Date;
  total: number;
  customerNotes?: string | null;
  dashboardUrl: string;
  locale?: EmailLocale;
  currency?: string;
  storeTimezone?: string | null;
  storeCountryCode?: string | null;
}

export function NewRequestLandlordEmail({
  storeName,
  logoUrl: _logoUrl,
  primaryColor,
  customerFirstName,
  customerLastName,
  customerEmail,
  reservationNumber,
  startDate,
  endDate,
  total,
  customerNotes,
  dashboardUrl,
  locale = "fr",
  currency = "EUR",
  storeTimezone,
  storeCountryCode,
}: NewRequestLandlordEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.newRequestLandlord;
  const datePatterns = getDateFormatPatterns(locale);
  const formatCurrency = getCurrencyFormatter(locale, currency);
  const trimmedNotes = customerNotes?.trim();
  const formatDate = (date: Date) =>
    formatEmailDateInStoreTimezone(
      date,
      locale,
      datePatterns.short,
      storeTimezone,
      storeCountryCode,
    );

  return (
    <BaseLayout
      preview={messages.subject.replace("{number}", reservationNumber)}
      storeName="Louez.io"
      logoUrl={null}
      primaryColor={primaryColor}
      locale={locale}
    >
      <EmailHeading>{messages.title}</EmailHeading>

      <EmailText>{messages.body.replace("{storeName}", storeName)}</EmailText>

      <Section style={styles.card}>
        <DetailRow
          label={stripLabelColon(messages.customer)}
          value={`${customerFirstName} ${customerLastName}`}
        />
        <DetailRow label={stripLabelColon(messages.email)} value={customerEmail} />
        <DetailRow
          label={stripLabelColon(messages.period)}
          value={`${formatDate(startDate)} – ${formatDate(endDate)}`}
        />
        <DetailRow label={stripLabelColon(messages.amount)} value={formatCurrency(total)} />
      </Section>

      {trimmedNotes && (
        <Section style={styles.card}>
          <Text style={{ ...styles.label, margin: "0 0 8px 0" }}>{messages.notes}</Text>
          <Text style={notesText}>{trimmedNotes}</Text>
        </Section>
      )}

      <CtaButton href={dashboardUrl} label={messages.viewRequest} primaryColor={primaryColor} />

      <FooterNote>{messages.connectToManage}</FooterNote>
    </BaseLayout>
  );
}

const notesText = {
  ...styles.paragraph,
  margin: "0",
  whiteSpace: "pre-wrap" as const,
};

export default NewRequestLandlordEmail;
