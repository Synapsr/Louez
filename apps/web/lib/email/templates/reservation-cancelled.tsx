import { Fragment } from "react";
import { Link } from "@react-email/components";
import type { EmailCustomContent } from "@louez/types";
import { BaseLayout } from "./base-layout";
import {
  EmailHeading,
  EmailText,
  InfoCard,
  InfoCardItem,
  Signature,
  emailTheme,
  resolveCustomContent,
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
  items: Array<{ name: string; quantity: number }>;
  storefrontUrl?: string;
  /** The store's own subject, greeting and message (notification settings). */
  customContent?: EmailCustomContent;
  locale?: EmailLocale;
}

/**
 * The store cancelled the reservation: its number, dates and items, and how
 * to reach the store. It says nothing of a refund: a cancellation refunds
 * nothing by itself, and a refund is its own step.
 */
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
  items,
  storefrontUrl,
  customContent,
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

  const { greeting, message, signature } = resolveCustomContent(
    customContent,
    {
      greeting: tc.greeting,
      signature: `${tc.regards}\n${tc.team.replace("{storeName}", storeName)}`,
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

      <EmailText>{messages.body.replace("{number}", reservationNumber)}</EmailText>

      {/* Custom message from store settings */}
      {message && <EmailText>{message}</EmailText>}

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
        {items.length > 0 && (
          <InfoCardItem
            label={messages.itemsLabel}
            value={items.map((item, index) => (
              <Fragment key={index}>
                {index > 0 && <br />}
                {item.name}
                {item.quantity > 1 ? ` × ${item.quantity}` : ""}
              </Fragment>
            ))}
          />
        )}
      </InfoCard>

      <EmailText>{messages.contactForQuestions}</EmailText>

      {(storeEmail || storePhone) && (
        <InfoCard
          label={tc.contactUs}
          value={
            <>
              {storeEmail}
              {storeEmail && storePhone && <br />}
              {storePhone}
            </>
          }
        />
      )}

      {/* Quiet link to the storefront */}
      {storefrontUrl && (
        <EmailText center>
          <Link href={storefrontUrl} style={quietLink}>
            {messages.browseEquipment}
          </Link>
        </EmailText>
      )}

      <EmailText>{messages.thankYou}</EmailText>

      <Signature text={signature} />
    </BaseLayout>
  );
}

const quietLink = {
  color: emailTheme.colors.muted,
  textDecoration: "underline",
};

export default ReservationCancelledEmail;
