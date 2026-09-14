import { BaseLayout } from "./base-layout";
import { CtaButton, EmailHeading, EmailText, FooterNote, InfoCard } from "./components";
import { getEmailTranslations, getDateFormatPatterns, type EmailLocale } from "../i18n";
import { formatEmailDateInStoreTimezone, getStoreTimezoneLabel } from "../date-time";

interface ThankYouReviewEmailProps {
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
  reviewUrl: string;
  locale?: EmailLocale;
}

export function ThankYouReviewEmail({
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
  reviewUrl,
  locale = "fr",
}: ThankYouReviewEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.thankYouReview;
  const tc = t.common;
  const datePatterns = getDateFormatPatterns(locale);
  const timezoneLabel = getStoreTimezoneLabel(startDate, storeTimezone, storeCountry);
  const timezoneLine =
    typeof tc.timezone === "string"
      ? tc.timezone.replace("{timezone}", timezoneLabel)
      : `Timezone: ${timezoneLabel}`;

  const greeting = tc.greeting.replace("{name}", customerFirstName);

  return (
    <BaseLayout
      preview={messages.subject}
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

      <InfoCard
        label={tc.summary}
        value={
          <>
            {tc.reservationNumber.replace("{number}", reservationNumber)}
            <br />
            {tc.periodFrom.replace(
              "{startDate}",
              formatEmailDateInStoreTimezone(
                startDate,
                locale,
                datePatterns.short,
                storeTimezone,
                storeCountry,
              ),
            )}
            {" - "}
            {formatEmailDateInStoreTimezone(
              endDate,
              locale,
              datePatterns.short,
              storeTimezone,
              storeCountry,
            )}
          </>
        }
        footnote={timezoneLine}
      />

      <CtaButton href={reviewUrl} label={messages.cta} primaryColor={primaryColor} />

      <FooterNote>{messages.disclaimer}</FooterNote>
    </BaseLayout>
  );
}

export default ThankYouReviewEmail;
