import { Link } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import {
  EmailHeading,
  EmailText,
  FooterNote,
  InfoCard,
  InfoCardItem,
  emailTheme,
} from "./components";
import { getEmailTranslations, getDateFormatPatterns, type EmailLocale } from "../i18n";
import { formatEmailDateInStoreTimezone, getStoreTimezoneLabel } from "../date-time";

interface ReservationCancelledEmailProps {
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
  reason?: string | null;
  storefrontUrl?: string;
  locale?: EmailLocale;
}

export function ReservationCancelledEmail({
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
  reason,
  storefrontUrl,
  locale = "fr",
}: ReservationCancelledEmailProps) {
  const t = getEmailTranslations(locale);
  const messages = t.reservationCancelled;
  const tc = t.common;
  const datePatterns = getDateFormatPatterns(locale);
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
        label={messages.cancelledPeriod}
        value={
          <>
            {tc.periodFrom.replace("{startDate}", formatDate(startDate))}
            <br />
            {tc.periodTo.replace("{endDate}", formatDate(endDate))}
          </>
        }
        footnote={timezoneLine}
      >
        {reason && <InfoCardItem label={messages.reasonLabel} value={reason} />}
      </InfoCard>

      <EmailText>{messages.contactForQuestions}</EmailText>

      {/* Quiet link to the storefront */}
      {storefrontUrl && (
        <EmailText center>
          <Link href={storefrontUrl} style={quietLink}>
            {messages.browseEquipment}
          </Link>
        </EmailText>
      )}

      <FooterNote>{messages.thankYou}</FooterNote>
    </BaseLayout>
  );
}

const quietLink = {
  color: emailTheme.colors.muted,
  textDecoration: "underline",
};

export default ReservationCancelledEmail;
