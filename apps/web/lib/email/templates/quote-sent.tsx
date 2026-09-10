import { BaseLayout } from "./base-layout";
import {
  CtaButton,
  EmailHeading,
  EmailText,
  FooterNote,
  InfoCard,
  InfoCardItem,
  ItemsTable,
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

interface QuoteSentEmailProps {
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
  reservationUrl: string;
  customContent?: EmailCustomContent;
  locale?: EmailLocale;
  currency?: string;
}

export function QuoteSentEmail({
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
  reservationUrl,
  customContent,
  locale = "fr",
  currency = "EUR",
}: QuoteSentEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.quoteSent;
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

  const { greeting } = resolveCustomContent(
    customContent,
    {
      greeting: tc.greeting,
      signature: `${tc.regards}\n${tc.team.replace("{storeName}", storeName)}`,
    },
    { name: customerFirstName, number: reservationNumber },
  );

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

      <EmailText>{greeting}</EmailText>

      <EmailText>
        {messages.body.replace("{number}", reservationNumber).replace("{store}", storeName)}
      </EmailText>

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

      <EmailText bold>{messages.yourQuote}</EmailText>

      <ItemsTable
        items={items}
        totals={[{ label: tc.totalToPay, amount: total, bold: true }]}
        formatCurrency={formatCurrency}
      />

      <CtaButton href={reservationUrl} label={messages.viewQuote} primaryColor={primaryColor} />

      <FooterNote>{messages.expiry}</FooterNote>
    </BaseLayout>
  );
}

export default QuoteSentEmail;
