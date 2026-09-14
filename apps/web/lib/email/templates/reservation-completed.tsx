import { Link } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import { EmailHeading, EmailText, FooterNote, InfoCard, emailTheme } from "./components";
import {
  getEmailTranslations,
  getDateFormatPatterns,
  getCurrencyFormatter,
  type EmailLocale,
} from "../i18n";
import { formatEmailDateInStoreTimezone, getStoreTimezoneLabel } from "../date-time";

interface ReservationCompletedEmailProps {
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
  startDate: Date;
  endDate: Date;
  depositAmount?: number | null;
  depositReturned?: boolean;
  storefrontUrl?: string;
  locale?: EmailLocale;
  currency?: string;
}

export function ReservationCompletedEmail({
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
  startDate,
  endDate,
  depositAmount,
  depositReturned = false,
  storefrontUrl,
  locale = "fr",
  currency = "EUR",
}: ReservationCompletedEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.reservationCompleted;
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

      <InfoCard
        label={messages.rentalPeriod}
        value={
          <>
            {tc.periodFrom.replace("{startDate}", formatDate(startDate))}
            <br />
            {tc.periodTo.replace("{endDate}", formatDate(endDate))}
          </>
        }
        footnote={timezoneLine}
      />

      {/* Deposit status */}
      {depositAmount != null && depositAmount > 0 && (
        <InfoCard
          label={tc.deposit}
          value={
            depositReturned
              ? messages.depositReturned.replace("{amount}", formatCurrency(depositAmount))
              : messages.depositPending.replace("{amount}", formatCurrency(depositAmount))
          }
        />
      )}

      <EmailText>{messages.thankYouMessage}</EmailText>

      {/* Quiet link to the storefront */}
      {storefrontUrl && (
        <EmailText center>
          <Link href={storefrontUrl} style={quietLink}>
            {messages.rentAgain}
          </Link>
        </EmailText>
      )}

      <FooterNote>{messages.seeYouSoon}</FooterNote>
    </BaseLayout>
  );
}

const quietLink = {
  color: emailTheme.colors.muted,
  textDecoration: "underline",
};

export default ReservationCompletedEmail;
