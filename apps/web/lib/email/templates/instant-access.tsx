import { BaseLayout } from "./base-layout";
import {
  CtaButton,
  EmailHeading,
  EmailText,
  FooterNote,
  InfoCard,
  ItemsTable,
  StoreNote,
} from "./components";
import {
  getEmailTranslations,
  getDateFormatPatterns,
  getCurrencyFormatter,
  type EmailLocale,
} from "../i18n";
import { formatEmailDateInStoreTimezone, getStoreTimezoneLabel } from "../date-time";

interface InstantAccessItem {
  name: string;
  quantity: number;
  totalPrice: number;
}

interface InstantAccessEmailProps {
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  storeAddress?: string | null;
  storePhone?: string | null;
  storeEmail?: string | null;
  storeTimezone?: string | null;
  storeCountry?: string | null;
  customerFirstName: string;
  reservationNumber: string;
  startDate: Date;
  endDate: Date;
  items: InstantAccessItem[];
  totalAmount: number;
  accessUrl: string;
  showPaymentCta: boolean;
  /** Free text the store owner added when sending this link by hand. */
  additionalMessage?: string | null;
  locale?: EmailLocale;
  currency?: string;
}

export function InstantAccessEmail({
  storeName,
  logoUrl,
  primaryColor,
  storeAddress,
  storePhone,
  storeEmail,
  storeTimezone,
  storeCountry,
  customerFirstName,
  reservationNumber,
  startDate,
  endDate,
  items,
  totalAmount,
  accessUrl,
  showPaymentCta,
  additionalMessage,
  locale = "fr",
  currency = "EUR",
}: InstantAccessEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.instantAccess;
  const tc = t.common;
  const datePatterns = getDateFormatPatterns(locale);
  const formatCurrency = getCurrencyFormatter(locale, currency);
  const timezoneLabel = getStoreTimezoneLabel(startDate, storeTimezone, storeCountry);
  const timezoneLine =
    typeof tc.timezone === "string"
      ? tc.timezone.replace("{timezone}", timezoneLabel)
      : `Timezone: ${timezoneLabel}`;

  const formatDate = (date: Date) =>
    formatEmailDateInStoreTimezone(date, locale, datePatterns.full, storeTimezone, storeCountry);

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

      <StoreNote message={additionalMessage} />

      <InfoCard
        label={tc.period}
        value={
          <>
            {tc.periodFrom.replace("{startDate}", formatDate(startDate))}
            <br />
            {tc.periodTo.replace("{endDate}", formatDate(endDate))}
          </>
        }
        footnote={timezoneLine}
      />

      <ItemsTable
        items={items}
        totals={[{ label: tc.total, amount: totalAmount, bold: true }]}
        formatCurrency={formatCurrency}
      />

      {/* Payment notice if unpaid */}
      {showPaymentCta && (
        <EmailText muted center small>
          {messages.paymentPending}
        </EmailText>
      )}

      <CtaButton
        href={accessUrl}
        label={showPaymentCta ? messages.viewAndPay : tc.viewReservation}
        primaryColor={primaryColor}
      />

      <FooterNote>{messages.linkValid}</FooterNote>
    </BaseLayout>
  );
}

export default InstantAccessEmail;
