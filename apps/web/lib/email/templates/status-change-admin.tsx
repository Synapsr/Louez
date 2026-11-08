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

/** What the customer did to a reservation, for the store owner. */
export type StatusChangeAdminEmailKind = "confirmed" | "cancelled" | "quote_declined";

interface StatusChangeAdminEmailProps {
  kind: StatusChangeAdminEmailKind;
  storeName: string;
  primaryColor?: string;
  customer?: { firstName: string; lastName: string; email: string } | null;
  reservationNumber: string;
  startDate: Date;
  endDate: Date;
  reservationTotal: number;
  dashboardUrl: string;
  locale?: EmailLocale;
  /** The reservation total's currency. */
  currency?: string;
  storeTimezone?: string | null;
  storeCountryCode?: string | null;
}

/** The subject of a status change email to the store owner. */
export const getStatusChangeAdminEmailSubject = (
  kind: StatusChangeAdminEmailKind,
  reservationNumber: string,
  locale: EmailLocale,
): string =>
  getEmailTranslations(locale).statusChangeAdmin[kind].subject.replace(
    "{number}",
    reservationNumber,
  );

export function StatusChangeAdminEmail({
  kind,
  storeName,
  primaryColor,
  customer,
  reservationNumber,
  startDate,
  endDate,
  reservationTotal,
  dashboardUrl,
  locale = "fr",
  currency = "EUR",
  storeTimezone,
  storeCountryCode,
}: StatusChangeAdminEmailProps) {
  const messages = getEmailTranslations(locale).statusChangeAdmin;
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
      preview={getStatusChangeAdminEmailSubject(kind, reservationNumber, locale)}
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
      </Section>

      <CtaButton href={dashboardUrl} label={messages.viewReservation} primaryColor={primaryColor} />

      <FooterNote>{messages.connectToManage}</FooterNote>
    </BaseLayout>
  );
}

export default StatusChangeAdminEmail;
