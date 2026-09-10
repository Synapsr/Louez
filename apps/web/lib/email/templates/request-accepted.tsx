import { Link } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import {
  CtaButton,
  EmailHeading,
  EmailText,
  FooterNote,
  InfoCard,
  InfoCardItem,
  ItemsTable,
  emailTheme,
  resolveCustomContent,
} from "./components";
import {
  getEmailTranslations,
  getDateFormatPatterns,
  getCurrencyFormatter,
  type EmailLocale,
} from "../i18n";
import type { EmailCustomContent } from "@louez/types";
import { formatEmailDateInStoreTimezone, getStoreTimezoneLabel } from "../date-time";

interface ReservationItem {
  name: string;
  quantity: number;
  totalPrice: number;
}

interface RequestAcceptedEmailProps {
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
  items: ReservationItem[];
  total: number;
  deposit?: number;
  reservationUrl: string;
  contractUrl: string;
  termsUrl?: string | null;
  paymentUrl?: string | null;
  customContent?: EmailCustomContent;
  locale?: EmailLocale;
  currency?: string;
}

export function RequestAcceptedEmail({
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
  items,
  total,
  deposit = 0,
  reservationUrl,
  contractUrl,
  termsUrl,
  paymentUrl,
  customContent,
  locale = "fr",
  currency = "EUR",
}: RequestAcceptedEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.requestAccepted;
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

  const { greeting, message } = resolveCustomContent(
    customContent,
    {
      greeting: tc.greeting,
      signature: `${tc.regards}\n${tc.team.replace("{storeName}", storeName)}`,
    },
    { name: customerFirstName, number: reservationNumber },
  );

  const totals = [
    ...(deposit > 0 ? [{ label: tc.deposit, amount: deposit }] : []),
    { label: tc.totalToPay, amount: total, bold: true },
  ];

  return (
    <BaseLayout
      preview={
        customContent?.subject?.replace("{number}", reservationNumber) ||
        messages.subject.replace("{number}", reservationNumber)
      }
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      storeAddress={storeAddress}
      locale={locale}
    >
      <EmailHeading>{messages.title}</EmailHeading>

      <EmailText>{greeting}</EmailText>

      <EmailText>{messages.body.replace("{number}", reservationNumber)}</EmailText>

      {/* Custom message from store settings */}
      {message && <EmailText>{message}</EmailText>}

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
      >
        {storeAddress && (
          <InfoCardItem
            label={tc.pickupAddress}
            value={
              <>
                {storeName}
                <br />
                {storeAddress}
              </>
            }
          />
        )}
      </InfoCard>

      <EmailText bold>{messages.yourReservation}</EmailText>

      <ItemsTable items={items} totals={totals} formatCurrency={formatCurrency} />

      <CtaButton
        href={paymentUrl || reservationUrl}
        label={paymentUrl ? messages.proceedPayment : tc.viewReservation}
        primaryColor={primaryColor}
      />

      <FooterNote>
        {termsUrl ? messages.legalAcceptance : messages.contractAvailable}
        <br />
        <Link href={contractUrl} style={legalLink}>
          {messages.viewContract}
        </Link>
        {termsUrl && (
          <>
            {" · "}
            <Link href={termsUrl} style={legalLink}>
              {messages.viewTerms}
            </Link>
          </>
        )}
      </FooterNote>
    </BaseLayout>
  );
}

const legalLink = {
  color: emailTheme.colors.muted,
  textDecoration: "underline",
};

export default RequestAcceptedEmail;
