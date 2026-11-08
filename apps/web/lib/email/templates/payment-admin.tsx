import { Section } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import { CtaButton, DetailRow, EmailHeading, EmailText, FooterNote, styles } from "./components";
import {
  getEmailTranslations,
  getDateFormatPatterns,
  getCurrencyFormatter,
  type EmailLocale,
} from "../i18n";
import { formatEmailDateInStoreTimezone } from "../date-time";

/** What happened to a reservation's payment, for the store owner. */
export type PaymentAdminEmailKind = "received" | "failed";

interface PaymentAdminEmailProps {
  kind: PaymentAdminEmailKind;
  storeName: string;
  primaryColor?: string;
  /** Absent when the payment has no customer on record. */
  customer?: { firstName: string; lastName: string; email: string } | null;
  reservationNumber: string;
  startDate: Date;
  endDate: Date;
  /** The payment's own amount. */
  amount: number;
  reservationTotal: number;
  dashboardUrl: string;
  locale?: EmailLocale;
  currency?: string;
  storeTimezone?: string | null;
  storeCountryCode?: string | null;
}

/** The subject of a payment email to the store owner. */
export const getPaymentAdminEmailSubject = (
  kind: PaymentAdminEmailKind,
  reservationNumber: string,
  locale: EmailLocale,
): string =>
  getEmailTranslations(locale).paymentAdmin[kind].subject.replace("{number}", reservationNumber);

export function PaymentAdminEmail({
  kind,
  storeName,
  primaryColor,
  customer,
  reservationNumber,
  startDate,
  endDate,
  amount,
  reservationTotal,
  dashboardUrl,
  locale = "fr",
  currency = "EUR",
  storeTimezone,
  storeCountryCode,
}: PaymentAdminEmailProps) {
  const messages = getEmailTranslations(locale).paymentAdmin;
  const event = messages[kind];
  const datePatterns = getDateFormatPatterns(locale);
  const formatCurrency = getCurrencyFormatter(locale, currency);
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
      preview={getPaymentAdminEmailSubject(kind, reservationNumber, locale)}
      storeName="Louez.io"
      logoUrl={null}
      primaryColor={primaryColor}
      locale={locale}
    >
      <EmailHeading>{event.title}</EmailHeading>

      <EmailText>
        {event.body.replace("{number}", reservationNumber).replace("{storeName}", storeName)}
      </EmailText>

      <Section style={styles.card}>
        {customer && (
          <>
            <DetailRow
              label={messages.customer}
              value={`${customer.firstName} ${customer.lastName}`}
            />
            <DetailRow label={messages.email} value={customer.email} />
          </>
        )}
        <DetailRow
          label={messages.period}
          value={`${formatDate(startDate)} – ${formatDate(endDate)}`}
        />
        <DetailRow label={messages.total} value={formatCurrency(reservationTotal)} />
        <DetailRow label={event.amount} value={formatCurrency(amount)} emphasis="amount" />
      </Section>

      <CtaButton href={dashboardUrl} label={messages.viewReservation} primaryColor={primaryColor} />

      <FooterNote>{messages.connectToManage}</FooterNote>
    </BaseLayout>
  );
}

export default PaymentAdminEmail;
