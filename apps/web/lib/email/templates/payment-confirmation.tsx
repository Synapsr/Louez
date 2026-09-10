import { Hr, Section, Text } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import { CtaButton, DetailRow, EmailHeading, EmailText, styles } from "./components";
import {
  getEmailTranslations,
  getDateFormatPatterns,
  getCurrencyFormatter,
  type EmailLocale,
} from "../i18n";
import { formatEmailDateInStoreTimezone, getStoreTimezoneLabel } from "../date-time";

interface PaymentConfirmationEmailProps {
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  storeAddress?: string | null;
  storeEmail?: string | null;
  storePhone?: string | null;
  storeTimezone?: string | null;
  storeCountry?: string | null;
  customerFirstName: string;
  reservationNumber: string;
  paymentAmount: number;
  paymentDate: Date;
  paymentMethod?: string | null;
  reservationUrl?: string;
  contractSignatureUrl?: string;
  locale?: EmailLocale;
  currency?: string;
}

export function PaymentConfirmationEmail({
  storeName,
  logoUrl,
  primaryColor,
  storeAddress,
  storeEmail,
  storePhone,
  storeTimezone,
  storeCountry,
  customerFirstName,
  reservationNumber,
  paymentAmount,
  paymentDate,
  paymentMethod,
  reservationUrl,
  contractSignatureUrl,
  locale = "fr",
  currency = "EUR",
}: PaymentConfirmationEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.paymentConfirmation;
  const tc = t.common;
  const datePatterns = getDateFormatPatterns(locale);
  const formatCurrency = getCurrencyFormatter(locale, currency);
  const timezoneLabel = getStoreTimezoneLabel(paymentDate, storeTimezone, storeCountry);
  const timezoneLine =
    typeof tc.timezone === "string"
      ? tc.timezone.replace("{timezone}", timezoneLabel)
      : `Timezone: ${timezoneLabel}`;
  const contractSignatureText =
    typeof messages.contractSignature === "string"
      ? messages.contractSignature
      : t.requestAccepted.contractAvailable;
  const contractSignatureLabel =
    typeof messages.signContract === "string"
      ? messages.signContract
      : t.requestAccepted.viewContract;

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

      <EmailText>{tc.greeting.replace("{name}", customerFirstName)}</EmailText>

      <EmailText>{messages.body.replace("{number}", reservationNumber)}</EmailText>

      {/* Payment details */}
      <Section style={styles.card}>
        <Text style={{ ...styles.label, margin: "0 0 12px 0" }}>{messages.paymentDetails}</Text>

        <DetailRow label={messages.reservation} value={<>#{reservationNumber}</>} />

        <DetailRow
          label={messages.date}
          value={formatEmailDateInStoreTimezone(
            paymentDate,
            locale,
            datePatterns.dateTime,
            storeTimezone,
            storeCountry,
          )}
        />

        <Text style={{ ...styles.small, margin: "0 0 4px 0" }}>{timezoneLine}</Text>

        {paymentMethod && <DetailRow label={messages.method} value={paymentMethod} />}

        <Hr style={styles.hr} />

        <DetailRow
          label={messages.amount}
          value={formatCurrency(paymentAmount)}
          emphasis="amount"
        />
      </Section>

      <EmailText>{messages.confirmation}</EmailText>

      {/* CTA */}
      {reservationUrl && (
        <CtaButton href={reservationUrl} label={tc.viewReservation} primaryColor={primaryColor} />
      )}

      {contractSignatureUrl && (
        <>
          <EmailText>{contractSignatureText}</EmailText>
          <CtaButton
            href={contractSignatureUrl}
            label={contractSignatureLabel}
            primaryColor={primaryColor}
          />
        </>
      )}
    </BaseLayout>
  );
}

export default PaymentConfirmationEmail;
