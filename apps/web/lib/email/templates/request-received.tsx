import { BaseLayout } from "./base-layout";
import { EmailHeading, EmailText, InfoCard, Signature, resolveCustomContent } from "./components";
import { getEmailTranslations, getDateFormatPatterns, type EmailLocale } from "../i18n";
import type { EmailCustomContent } from "@louez/types";
import { formatEmailDateInStoreTimezone, getStoreTimezoneLabel } from "../date-time";

interface RequestReceivedEmailProps {
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  storeEmail?: string | null;
  storePhone?: string | null;
  storeAddress?: string | null;
  storeTimezone?: string | null;
  storeCountry?: string | null;
  customerFirstName: string;
  reservationNumber: string;
  startDate: Date;
  endDate: Date;
  customContent?: EmailCustomContent;
  locale?: EmailLocale;
}

export function RequestReceivedEmail({
  storeName,
  logoUrl,
  primaryColor,
  storeEmail,
  storePhone,
  storeAddress,
  storeTimezone,
  storeCountry,
  customerFirstName,
  reservationNumber,
  startDate,
  endDate,
  customContent,
  locale = "fr",
}: RequestReceivedEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.requestReceived;
  const tc = t.common;
  const datePatterns = getDateFormatPatterns(locale);
  const timezoneLabel = getStoreTimezoneLabel(startDate, storeTimezone, storeCountry);
  const timezoneLine =
    typeof tc.timezone === "string"
      ? tc.timezone.replace("{timezone}", timezoneLabel)
      : `Timezone: ${timezoneLabel}`;

  const formatDate = (date: Date) =>
    formatEmailDateInStoreTimezone(
      date,
      locale,
      datePatterns.dateTime,
      storeTimezone,
      storeCountry,
    );

  const { greeting, message, signature } = resolveCustomContent(
    customContent,
    {
      greeting: tc.greeting,
      signature: `${messages.seeYouSoon}\n${tc.team.replace("{storeName}", storeName)}`,
    },
    { name: customerFirstName, number: reservationNumber },
  );

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

      <EmailText>{messages.body}</EmailText>

      {/* Custom message from store settings */}
      {message && <EmailText>{message}</EmailText>}

      <InfoCard
        label={tc.reservationNumber.replace("{number}", reservationNumber)}
        value={
          <>
            {tc.periodFrom.replace("{startDate}", formatDate(startDate))}
            <br />
            {tc.periodTo.replace("{endDate}", formatDate(endDate))}
          </>
        }
        footnote={timezoneLine}
      />

      <EmailText>{messages.review}</EmailText>

      <EmailText>{messages.confirmation}</EmailText>

      <Signature text={signature} />
    </BaseLayout>
  );
}

export default RequestReceivedEmail;
